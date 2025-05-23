package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	// "io/ioutil" // Deprecated, use io package
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)


func writeJSONError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func writeJSONResponse(w http.ResponseWriter, data interface{}, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Error().Err(err).Msg("Failed to encode JSON response")
		// Avoid writing another header if one already sent by json.NewEncoder
	}
}

func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.Username == "" || req.Password == "" {
		writeJSONError(w, "Username and password are required", http.StatusBadRequest)
		return
	}
	if len(req.Password) < 6 {
		writeJSONError(w, "Password must be at least 6 characters", http.StatusBadRequest)
		return
	}

	existingUser, _ := GetUserByUsername(req.Username)
	if existingUser != nil {
		writeJSONError(w, "Username already taken", http.StatusConflict)
		return
	}

	user, err := CreateUser(req.Username, req.Password)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create user")
		writeJSONError(w, "Registration failed", http.StatusInternalServerError)
		return
	}
	log.Info().Str("username", user.Username).Msg("User registered successfully")
	writeJSONResponse(w, map[string]string{"message": "Registration successful"}, http.StatusCreated)
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	user, err := GetUserByUsername(req.Username)
	if err != nil || !VerifyPassword(user.PasswordHash, req.Password) {
		writeJSONError(w, "Invalid username or password", http.StatusUnauthorized)
		return
	}

	tokenString, expirationTime, err := GenerateJWT(user)
	if err != nil {
		log.Error().Err(err).Msg("Failed to generate JWT")
		writeJSONError(w, "Login failed", http.StatusInternalServerError)
		return
	}
	SetAuthCookie(w, tokenString, expirationTime)
	log.Info().Str("username", user.Username).Msg("User logged in")
	writeJSONResponse(w, map[string]string{"message": "Login successful", "username": user.Username}, http.StatusOK)
}

func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	ClearAuthCookie(w)
	writeJSONResponse(w, map[string]string{"message": "Logout successful"}, http.StatusOK)
}

func MeHandler(w http.ResponseWriter, r *http.Request) { // Protected by AuthMiddleware
    claims := GetClaimsFromContext(r)
    if claims == nil { // Should not happen if AuthMiddleware is working
        writeJSONError(w, "Unauthorized", http.StatusUnauthorized)
        return
    }
    writeJSONResponse(w, map[string]interface{}{
        "userId": claims.UserID, 
        "username": claims.Username,
    }, http.StatusOK)
}


// Serves the combined playlist (initial samples + user uploads + liked songs)
func SongsAPIHandler(w http.ResponseWriter, r *http.Request) { // Protected by TryAuthMiddleware
	if r.Method != http.MethodGet {
		writeJSONError(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	claims := GetClaimsFromContext(r)
	var userID *int
	if claims != nil {
		uid := claims.UserID
		userID = &uid
	}
	
	songs, err := GetSongsForUser(userID)
	if err != nil {
		log.Error().Err(err).Msg("Error fetching songs for user/guest")
		writeJSONError(w, "Failed to fetch songs", http.StatusInternalServerError)
		return
	}
	writeJSONResponse(w, songs, http.StatusOK)
}

func UploadSongHandler(w http.ResponseWriter, r *http.Request) { // Protected by AuthMiddleware
	if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims := GetClaimsFromContext(r)
	if claims == nil {
		writeJSONError(w, "Unauthorized", http.StatusUnauthorized) // Should be caught by middleware
		return
	}

	// Max upload size (e.g., 20MB)
	r.ParseMultipartForm(20 << 20)

	file, handler, err := r.FormFile("audioFile")
	if err != nil {
		log.Error().Err(err).Msg("Error retrieving the file from form")
		writeJSONError(w, "Error uploading file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	title := r.FormValue("title")
	artist := r.FormValue("artist")
	album := r.FormValue("album")
	// Duration might be extracted on client or with a lib on server
	durationStr := r.FormValue("duration") 
	duration, _ := strconv.Atoi(durationStr) // Handle error if needed

	if title == "" { title = strings.TrimSuffix(handler.Filename, filepath.Ext(handler.Filename)) }


	// Create user-specific uploads directory if it doesn't exist
	userUploadDir := filepath.Join("uploads", strconv.Itoa(claims.UserID))
	if err := os.MkdirAll(userUploadDir, os.ModePerm); err != nil {
		log.Error().Err(err).Msg("Failed to create upload directory")
		writeJSONError(w, "Server error during upload", http.StatusInternalServerError)
		return
	}

	// Sanitize filename and create a unique name to prevent overwrites/collisions
	safeFilename := uuid.New().String() + filepath.Ext(handler.Filename)
	filePath := filepath.Join(userUploadDir, safeFilename)
	
	dst, err := os.Create(filePath)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create file on server")
		writeJSONError(w, "Server error during upload", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		log.Error().Err(err).Msg("Failed to copy uploaded file")
		writeJSONError(w, "Server error during upload", http.StatusInternalServerError)
		return
	}

	// Relative path for DB and serving
	relativeFilePath := "/" + strings.ReplaceAll(filePath, "\\", "/") // Ensure forward slashes for web paths

	// For now, no separate cover upload, use default or derive
	relativeCoverPath := "/static/images/default-cover.jpg"

	newSong, err := AddUploadedSong(claims.UserID, title, artist, album, relativeFilePath, relativeCoverPath, duration)
	if err != nil {
		log.Error().Err(err).Msg("Failed to add uploaded song to DB")
		// Optionally delete the file if DB insert fails: os.Remove(filePath)
		writeJSONError(w, "Failed to save song metadata", http.StatusInternalServerError)
		return
	}

	log.Info().Str("filename", handler.Filename).Str("user", claims.Username).Msg("File uploaded successfully")
	writeJSONResponse(w, newSong, http.StatusCreated)
}


func LikeSongHandler(w http.ResponseWriter, r *http.Request) { // Protected by AuthMiddleware
    if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
    claims := GetClaimsFromContext(r) // User must be logged in
    if claims == nil { writeJSONError(w, "Unauthorized", http.StatusUnauthorized); return }

    var req LikeRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSONError(w, "Invalid request body for like", http.StatusBadRequest)
        return
    }
    if req.SongID == "" {
        writeJSONError(w, "Song ID is required to like a song", http.StatusBadRequest)
        return
    }

    // Ensure the song exists in our 'songs' table. If it's a Jamendo song, this might add it.
    dbSongID, err := EnsureSongExists(Song{
        ID: req.SongID, Title: req.Title, Artist: req.Artist, Album: req.Album,
        FilePath: req.FilePath, CoverPath: req.CoverPath, IsLocal: req.IsLocal, JamendoID: &req.JamendoID, Duration: req.Duration,
    })
    if err != nil {
        log.Error().Err(err).Str("requestedSongID", req.SongID).Msg("Failed to ensure song exists before liking")
        writeJSONError(w, "Error processing song for liking", http.StatusInternalServerError)
        return
    }

    if err := LikeSong(claims.UserID, dbSongID); err != nil {
        log.Error().Err(err).Int("userID", claims.UserID).Str("songID", dbSongID).Msg("Failed to like song")
        writeJSONError(w, "Failed to like song", http.StatusInternalServerError)
        return
    }
    writeJSONResponse(w, map[string]string{"message": "Song liked successfully", "songId": dbSongID}, http.StatusOK)
}

func UnlikeSongHandler(w http.ResponseWriter, r *http.Request) { // Protected by AuthMiddleware
    if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
    claims := GetClaimsFromContext(r)
    if claims == nil { writeJSONError(w, "Unauthorized", http.StatusUnauthorized); return }

    var req struct { SongID string `json:"songId"`} // Simpler request for unlike
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSONError(w, "Invalid request body for unlike", http.StatusBadRequest)
        return
    }
     if req.SongID == "" {
        writeJSONError(w, "Song ID is required to unlike a song", http.StatusBadRequest)
        return
    }

    if err := UnlikeSong(claims.UserID, req.SongID); err != nil {
        log.Error().Err(err).Int("userID", claims.UserID).Str("songID", req.SongID).Msg("Failed to unlike song")
        writeJSONError(w, "Failed to unlike song", http.StatusInternalServerError)
        return
    }
    writeJSONResponse(w, map[string]string{"message": "Song unliked successfully", "songId": req.SongID}, http.StatusOK)
}

func DeleteSongHandler(w http.ResponseWriter, r *http.Request) { // Protected by AuthMiddleware
    if r.Method != http.MethodDelete {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
    claims := GetClaimsFromContext(r)
    if claims == nil { writeJSONError(w, "Unauthorized", http.StatusUnauthorized); return }

    // Extract songID from path, e.g. /api/songs/{songIDToDelete}
    // For simplicity, let's assume it's a query param like /api/songs/delete?id=...
    // Or, better, get it from request body like other POSTs if it's a specific action button
    songID := r.URL.Query().Get("id")
    if songID == "" {
        var reqBody struct { SongID string `json:"songId"`}
        if err := json.NewDecoder(r.Body).Decode(&reqBody); err == nil && reqBody.SongID != "" {
            songID = reqBody.SongID
        } else {
             writeJSONError(w, "Song ID is required to delete a song", http.StatusBadRequest)
            return
        }
    }
    
    err := DeleteUserUploadedSong(claims.UserID, songID)
    if err != nil {
        log.Error().Err(err).Int("userID", claims.UserID).Str("songID", songID).Msg("Failed to delete song")
        // Distinguish between "not found/not owner" and server error
        if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "does not own") {
            writeJSONError(w, err.Error(), http.StatusForbidden)
        } else {
            writeJSONError(w, "Failed to delete song", http.StatusInternalServerError)
        }
        return
    }
    writeJSONResponse(w, map[string]string{"message": "Song deleted successfully", "songId": songID}, http.StatusOK)
}



// Jamendo search handler (from your original main.go, slightly adapted)
func JamendoSearchHandler(w http.ResponseWriter, r *http.Request) {
	// ... (Keep your existing JamendoSearchHandler logic from original main.go)
	// Ensure it transforms results into the `Song` struct defined in models.go
	// Example transformation part:
	// ... (fetch logic) ...
	// var results []Song
	// for _, track := range jamendoResp.Results {
	//     filePath := track.Audio
	//     if filePath == "" { filePath = track.AudioDownload }
	//     if filePath == "" { continue }
	//     coverPath := track.Image
	//     if coverPath == "" { coverPath = "/static/images/default-cover.jpg" }
	//     song := Song{
	//         ID:        fmt.Sprintf("jamendo-%s", track.ID),
	//         Title:     track.Name, Artist: track.ArtistName, Album: track.AlbumName,
	//         FilePath:  filePath, CoverPath: coverPath, IsLocal: false, Duration: track.Duration, JamendoID: &track.ID,
	//     }
	//     results = append(results, song)
	// }
	// writeJSONResponse(w, results, http.StatusOK)
	// --- PASTE YOUR FULL JAMENDO HANDLER HERE and adapt struct ---
	if r.Method != http.MethodGet { writeJSONError(w, "Method Not Allowed", 405); return }
	query := r.URL.Query().Get("query")
	if query == "" { http.Error(w, "Missing search query", 400); return }
	clientID := "5a074d04" // Reminder: Use ENV VAR in production
	apiURL := fmt.Sprintf("https://api.jamendo.com/v3.0/tracks/?client_id=%s&format=json&limit=50&search=%s&imagesize=300", clientID, url.QueryEscape(query))
	log.Info().Str("query", query).Msg("Calling Jamendo API")
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", apiURL, nil)
    if err != nil { log.Error().Err(err).Msg("Failed create Jamendo req"); writeJSONError(w,"API Error",500); return }
    req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil { log.Error().Err(err).Msg("Failed Jamendo API call"); writeJSONError(w, "API Error", 502); return }
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body) // Changed from ioutil.ReadAll
	if err != nil { log.Error().Err(err).Msg("Failed read Jamendo resp"); writeJSONError(w, "API Error", 500); return }
	if resp.StatusCode != http.StatusOK {
		log.Error().Int("status", resp.StatusCode).Str("body", string(body)).Msg("Jamendo API non-OK")
		writeJSONError(w, fmt.Sprintf("Jamendo API Error (%d)", resp.StatusCode), 502); return
	}
	var jamendoResp JamendoResponse
	if err := json.Unmarshal(body, &jamendoResp); err != nil {
		log.Error().Err(err).Str("body", string(body)).Msg("Failed parse Jamendo JSON resp");
		writeJSONError(w, "API Parse Error", 500); return
	}
	if jamendoResp.Headers.Status != "success" {
		log.Error().Interface("headers", jamendoResp.Headers).Msg("Jamendo API reported non-success")
		writeJSONError(w, "Jamendo API request failed", 502); return
	}
	var results []Song
	for _, track := range jamendoResp.Results {
		filePath := track.Audio; if filePath == "" { filePath = track.AudioDownload }; if filePath == "" { continue }
		coverPath := track.Image; if coverPath == "" { coverPath = "/static/images/default-cover.jpg" }
		jamendoTrackID := track.ID // Store original Jamendo ID
		song := Song{
			ID: fmt.Sprintf("jamendo-%s", jamendoTrackID), Title: track.Name, Artist: track.ArtistName, Album: track.AlbumName,
			FilePath: filePath, CoverPath: coverPath, IsLocal: false, Duration: track.Duration, JamendoID: &jamendoTrackID,
		}
		results = append(results, song)
	}
	log.Info().Int("count", len(results)).Str("query", query).Msg("Jamendo search yielded results")
	writeJSONResponse(w, results, http.StatusOK)
}