package main

import (
	"database/sql"
	"fmt"
	// "time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

func InitDB(dataSourceName string) {
	var err error
	db, err = sql.Open("mysql", dataSourceName)
	if err != nil {
		log.Fatal().Err(err).Msg("Error opening database")
	}
	if err = db.Ping(); err != nil {
		log.Fatal().Err(err).Msg("Error connecting to database")
	}
	log.Info().Msg("Successfully connected to the database!")
}

func CreateUser(username, password string) (*User, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}
	stmt, err := db.Prepare("INSERT INTO users(username, password_hash) VALUES(?, ?)")
	if err != nil {
		return nil, fmt.Errorf("failed to prepare user insert: %w", err)
	}
	defer stmt.Close()
	res, err := stmt.Exec(username, string(hashedPassword))
	if err != nil {
		return nil, fmt.Errorf("failed to execute user insert: %w", err) // Check for duplicate username error (MySQL error 1062)
	}
	id, _ := res.LastInsertId()
	return &User{ID: int(id), Username: username}, nil
}

func GetUserByUsername(username string) (*User, error) {
	user := &User{}
	row := db.QueryRow("SELECT id, username, password_hash, created_at FROM users WHERE username = ?", username)
	err := row.Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("user not found")
		}
		return nil, fmt.Errorf("failed to query user: %w", err)
	}
	return user, nil
}

// Initial sample songs (could also be loaded from DB if pre-populated)
var initialSampleSongs = []Song{
	{ID: "sample-1", Title: "Creative Minds", Artist: "Bensound", Album: "Royalty Free", FilePath: "/assets/audio/sample1.mp3", CoverPath: "/static/images/cover1.jpg", IsLocal: true, Duration: 146},
	{ID: "sample-2", Title: "A New Beginning", Artist: "Bensound", Album: "Inspiring", FilePath: "/assets/audio/sample2.mp3", CoverPath: "/static/images/cover2.jpg", IsLocal: true, Duration: 150},
}

// GetSongsForUser gets initial samples, user uploads, and marks liked songs
func GetSongsForUser(userID *int) ([]Song, error) {
	var finalPlaylist []Song
	
	// 1. Add initial sample songs
	finalPlaylist = append(finalPlaylist, initialSampleSongs...)

	var likedSongIDs = make(map[string]bool)
	if userID != nil { // If user is logged in
		// 2. Get user's uploaded songs
		rows, err := db.Query("SELECT id, title, artist, album, file_path, cover_path, duration FROM songs WHERE user_id = ? AND is_uploaded = TRUE", *userID)
		if err != nil {
			return nil, fmt.Errorf("failed to query user uploaded songs: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var s Song
			s.UserID = userID
			s.IsLocal = true // User uploads are treated as local from server's perspective
			s.IsUploaded = true
			s.CanDelete = true // User can delete their own uploads
			if err := rows.Scan(&s.ID, &s.Title, &s.Artist, &s.Album, &s.FilePath, &s.CoverPath, &s.Duration); err != nil {
				log.Error().Err(err).Msg("Failed to scan uploaded song")
				continue
			}
			finalPlaylist = append(finalPlaylist, s)
		}

		// 3. Get user's liked songs (Jamendo or Samples)
		// This query gets songs from the main 'songs' table that the user has liked.
		likedRows, err := db.Query(`
			SELECT s.id, s.title, s.artist, s.album, s.file_path, s.cover_path, s.is_local, s.jamendo_id, s.duration
			FROM songs s
			JOIN user_liked_songs uls ON s.id = uls.song_id
			WHERE uls.user_id = ?`, *userID)
		if err != nil {
			return nil, fmt.Errorf("failed to query user liked songs: %w", err)
		}
		defer likedRows.Close()
		
		tempLikedMap := make(map[string]Song) // To avoid duplicates if a sample is also liked

		for likedRows.Next() {
			var s Song
			s.UserID = userID // Mark as associated with user for context, though not "owned"
			if err := likedRows.Scan(&s.ID, &s.Title, &s.Artist, &s.Album, &s.FilePath, &s.CoverPath, &s.IsLocal, &s.JamendoID, &s.Duration); err != nil {
				log.Error().Err(err).Msg("Failed to scan liked song")
				continue
			}
			// If it's a liked sample song, it's already in finalPlaylist. We just need to mark it.
			// If it's a liked Jamendo song, add it to playlist if not already (e.g. from another user's like).
			isSample := false
			for _, sample := range initialSampleSongs {
				if sample.ID == s.ID {
					isSample = true
					break
				}
			}
			if !isSample && !s.IsUploaded { // If it's a liked Jamendo song, add to temp map
			    tempLikedMap[s.ID] = s
			}
			likedSongIDs[s.ID] = true // Mark this ID as liked
		}
		// Add unique liked Jamendo songs to final playlist
        for _, likedJamendoSong := range tempLikedMap {
            found := false
            for _, existingSong := range finalPlaylist {
                if existingSong.ID == likedJamendoSong.ID {
                    found = true
                    break
                }
            }
            if !found {
                finalPlaylist = append(finalPlaylist, likedJamendoSong)
            }
        }


		// Mark liked status for all songs in finalPlaylist
		for i := range finalPlaylist {
			if _, ok := likedSongIDs[finalPlaylist[i].ID]; ok {
				finalPlaylist[i].IsLiked = true
			}
		}
	} else {
        // Not logged in, only initial samples are marked as "not liked" by default
        for i := range finalPlaylist {
            finalPlaylist[i].IsLiked = false
        }
    }


	return finalPlaylist, nil
}

// AddUploadedSong adds a new song uploaded by a user
func AddUploadedSong(userID int, title, artist, album, relativeFilePath, relativeCoverPath string, duration int) (Song, error) {
	songID := "local-" + uuid.New().String() // Generate a unique ID for the uploaded song
	
	stmt, err := db.Prepare("INSERT INTO songs(id, user_id, title, artist, album, file_path, cover_path, is_local, is_uploaded, duration) VALUES(?, ?, ?, ?, ?, ?, ?, TRUE, TRUE, ?)")
	if err != nil {
		return Song{}, fmt.Errorf("failed to prepare song insert: %w", err)
	}
	defer stmt.Close()

	_, err = stmt.Exec(songID, userID, title, artist, album, relativeFilePath, relativeCoverPath, duration)
	if err != nil {
		return Song{}, fmt.Errorf("failed to execute song insert: %w", err)
	}
	
	return Song{
		ID: songID, UserID: &userID, Title: title, Artist: artist, Album: album,
		FilePath: relativeFilePath, CoverPath: relativeCoverPath, IsLocal: true, IsUploaded: true, Duration: duration, CanDelete: true,
	}, nil
}


// EnsureSongExists adds a song to the main 'songs' table if it doesn't exist, typically for Jamendo songs.
// Returns the song's ID (existing or new).
func EnsureSongExists(s Song) (string, error) {
    var existingID string
    var query string
    var args []interface{}

    if s.JamendoID != nil && *s.JamendoID != "" {
        // Check by JamendoID first
        query = "SELECT id FROM songs WHERE jamendo_id = ?"
        args = append(args, *s.JamendoID)
    } else if s.ID != "" && !s.IsLocal { // Non-local might have a predictable ID from source
         query = "SELECT id FROM songs WHERE id = ?"
         args = append(args, s.ID)
    } else { // Local song, ID must be provided or it's an error here
        if s.ID == "" { return "", fmt.Errorf("local song must have an ID to be ensured")}
        query = "SELECT id FROM songs WHERE id = ?"
        args = append(args, s.ID)
    }

    err := db.QueryRow(query, args...).Scan(&existingID)
    if err == nil {
        return existingID, nil // Song already exists
    }
    if err != sql.ErrNoRows {
        return "", fmt.Errorf("error checking for existing song: %w", err)
    }

    // Song doesn't exist, insert it
    // If ID is not set for a Jamendo song, use the convention
    if s.ID == "" && s.JamendoID != nil && *s.JamendoID != "" {
        s.ID = "jamendo-" + *s.JamendoID
    } else if s.ID == "" {
         s.ID = "external-" + uuid.New().String() // Fallback ID for non-Jamendo external
    }


    stmt, err := db.Prepare("INSERT INTO songs(id, title, artist, album, file_path, cover_path, is_local, jamendo_id, duration, user_id, is_uploaded) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, FALSE)")
    if err != nil {
        return "", fmt.Errorf("failed to prepare song insert for EnsureSongExists: %w", err)
    }
    defer stmt.Close()

    _, err = stmt.Exec(s.ID, s.Title, s.Artist, s.Album, s.FilePath, s.CoverPath, s.IsLocal, s.JamendoID, s.Duration)
    if err != nil {
        return "", fmt.Errorf("failed to insert new song for EnsureSongExists: %w", err)
    }
    return s.ID, nil
}


func LikeSong(userID int, songID string) error {
	stmt, err := db.Prepare("INSERT IGNORE INTO user_liked_songs(user_id, song_id) VALUES(?, ?)")
	if err != nil {
		return fmt.Errorf("failed to prepare like song statement: %w", err)
	}
	defer stmt.Close()
	_, err = stmt.Exec(userID, songID)
	if err != nil {
		return fmt.Errorf("failed to execute like song: %w", err)
	}
	return nil
}

func UnlikeSong(userID int, songID string) error {
	stmt, err := db.Prepare("DELETE FROM user_liked_songs WHERE user_id = ? AND song_id = ?")
	if err != nil {
		return fmt.Errorf("failed to prepare unlike song statement: %w", err)
	}
	defer stmt.Close()
	_, err = stmt.Exec(userID, songID)
	if err != nil {
		return fmt.Errorf("failed to execute unlike song: %w", err)
	}
	return nil
}

func DeleteUserUploadedSong(userID int, songID string) error {
    // First, verify the user owns this song and it's an upload
    var ownerID sql.NullInt64
    var filePath sql.NullString
    err := db.QueryRow("SELECT user_id, file_path FROM songs WHERE id = ? AND is_uploaded = TRUE", songID).Scan(&ownerID, &filePath)
    if err != nil {
        if err == sql.ErrNoRows {
            return fmt.Errorf("song not found or not an uploaded song")
        }
        return fmt.Errorf("error checking song ownership: %w", err)
    }
    if !ownerID.Valid || ownerID.Int64 != int64(userID) {
        return fmt.Errorf("user does not own this song or invalid owner ID")
    }

    tx, err := db.Begin()
    if err != nil {
        return fmt.Errorf("failed to begin transaction: %w", err)
    }

    // Delete from user_liked_songs first (referential integrity)
    _, err = tx.Exec("DELETE FROM user_liked_songs WHERE song_id = ?", songID)
    if err != nil {
        tx.Rollback()
        return fmt.Errorf("failed to delete likes for song: %w", err)
    }

    // Then delete from songs table
    _, err = tx.Exec("DELETE FROM songs WHERE id = ? AND user_id = ?", songID, userID)
    if err != nil {
        tx.Rollback()
        return fmt.Errorf("failed to delete song from songs table: %w", err)
    }

    if err := tx.Commit(); err != nil {
        return fmt.Errorf("failed to commit transaction: %w", err)
    }

    // Optionally, delete the actual file from disk
    // if filePath.Valid && filePath.String != "" {
    //     // Construct full path carefully and delete os.Remove(fullPath)
    //     log.Info().Str("filePath", filePath.String).Msg("Physical file deletion would happen here")
    // }
    return nil
}