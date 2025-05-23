package main

import "time"

// User struct for database and JWT claims
type User struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"` // Don't send hash to client
	CreatedAt    time.Time `json:"createdAt"`
}

// Song struct from your original main.go, adapted
type Song struct {
	ID          string `json:"id"`
	UserID      *int   `json:"userId,omitempty"` // Pointer to allow NULL for general songs
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	FilePath    string `json:"filePath"`
	CoverPath   string `json:"coverPath"`
	IsLocal     bool   `json:"isLocal"`     // True for initial samples or user uploads
	IsUploaded  bool   `json:"isUploaded"`  // True only for user uploads
	JamendoID   *string `json:"jamendoId,omitempty"` // If it's a Jamendo track
	Duration    int    `json:"duration"`
	IsLiked     bool   `json:"isLiked,omitempty"` // Dynamically set per user
	CanDelete   bool   `json:"canDelete,omitempty"` // Dynamically set if user owns uploaded song
}

// For Jamendo API responses (from your main.go)
type JamendoTrack struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Duration      int    `json:"duration"`
	ArtistName    string `json:"artist_name"`
	AlbumName     string `json:"album_name"`
	Audio         string `json:"audio"`
	AudioDownload string `json:"audiodownload"`
	Image         string `json:"image"`
}

type JamendoResponse struct {
	Headers struct {
		Status string `json:"status"`
		Code   int    `json:"code"`
	} `json:"headers"`
	Results []JamendoTrack `json:"results"`
}

// For login/register request bodies
type AuthRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// For like request
type LikeRequest struct {
    SongID      string `json:"songId"`      // e.g., "jamendo-123" or "local-uuid-abc"
    Title       string `json:"title"`       // Needed if song doesn't exist in DB yet
    Artist      string `json:"artist"`
    Album       string `json:"album"`
    FilePath    string `json:"filePath"`    // Playable URL for Jamendo
    CoverPath   string `json:"coverPath"`
    Duration    int    `json:"duration"`
    IsLocal     bool   `json:"isLocal"`     // False for Jamendo
    JamendoID   string `json:"jamendoId,omitempty"` // Original Jamendo ID if it's a Jamendo song
}