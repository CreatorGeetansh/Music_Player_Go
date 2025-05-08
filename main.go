package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// Song struct - ID is now string, added IsLocal
type Song struct {
	ID        string `json:"id"` // Use string for Jamendo IDs, local IDs, etc.
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	Album     string `json:"album"`
	FilePath  string `json:"filePath"`  // Will contain playable HTTP URL for Jamendo tracks
	CoverPath string `json:"coverPath"` // Image URL from Jamendo
	IsLocal   bool   `json:"isLocal"`   // Distinguishes server/uploaded files from API results
	Duration  int    `json:"duration"`  // Duration in seconds from Jamendo
}

// Global playlist now holds both local and potentially added API songs
var currentInternalPlaylist []Song // Renamed for clarity
var tmpl *template.Template

// --- Jamendo API specific structs ---
type JamendoTrack struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Duration      int    `json:"duration"` // seconds
	ArtistName    string `json:"artist_name"`
	AlbumName     string `json:"album_name"`
	Audio         string `json:"audio"`         // URL for ~96kbps stream
	AudioDownload string `json:"audiodownload"` // URL for ~128kbps stream (use as fallback)
	Image         string `json:"image"`         // URL for cover art
}

type JamendoResponse struct {
	Headers struct {
		Status string `json:"status"`
		Code   int    `json:"code"`
	} `json:"headers"`
	Results []JamendoTrack `json:"results"`
}


// --- Logging Middleware (No changes needed) ---
type loggingResponseWriter struct { http.ResponseWriter; statusCode int }
func newLoggingResponseWriter(w http.ResponseWriter) *loggingResponseWriter { return &loggingResponseWriter{w, http.StatusOK} }
func (lrw *loggingResponseWriter) WriteHeader(code int) { lrw.statusCode = code; lrw.ResponseWriter.WriteHeader(code) }
func httpLogger(handler http.Handler) http.Handler { /* ... (same as before) ... */
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now(); lrw := newLoggingResponseWriter(w); handler.ServeHTTP(lrw, r); duration := time.Since(start)
		var event *zerolog.Event; if lrw.statusCode >= 500 { event = log.Error() } else if lrw.statusCode >= 400 { event = log.Warn() } else { event = log.Info() }
		event.Str("method", r.Method).Str("path", r.URL.Path).Int("status_code", lrw.statusCode).Dur("duration", duration).Msg("HTTP request")
	})
 }


func main() {
	// --- Logger Setup ---
	logLevelStr := os.Getenv("LOG_LEVEL"); logLevel, err := zerolog.ParseLevel(logLevelStr); if err != nil || logLevelStr == "" { logLevel = zerolog.InfoLevel }
	var appLogger zerolog.Logger; if os.Getenv("APP_ENV") == "production" { appLogger = zerolog.New(os.Stdout).Level(logLevel).With().Timestamp().Logger() } else { output := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}; appLogger = zerolog.New(output).Level(logLevel).With().Timestamp().Caller().Logger() }
	log.Logger = appLogger; log.Info().Msg("Logger initialized.")

	// --- Initial Local Playlist ---
	currentInternalPlaylist = []Song{
		{ ID: "local-1", Title: "Creative Minds", Artist: "Bensound", Album: "Royalty Free", FilePath: "/assets/audio/sample1.mp3", CoverPath: "/static/images/cover1.jpg", IsLocal: true, Duration: 146 }, // Approx duration
		{ ID: "local-2", Title: "A New Beginning", Artist: "Bensound", Album: "Inspiring", FilePath: "/assets/audio/sample2.mp3", CoverPath: "/static/images/cover2.jpg", IsLocal: true, Duration: 150 }, // Approx duration
	}
	log.Info().Int("count", len(currentInternalPlaylist)).Msg("Initial local playlist loaded")

	// --- Templates ---
	tmpl, err = template.ParseFiles("templates/index.html"); if err != nil { log.Fatal().Err(err).Msg("Error parsing HTML template") }
	log.Info().Msg("HTML template parsed successfully")

	// --- HTTP Server Setup ---
	mux := http.NewServeMux()
	mux.HandleFunc("/", indexHandler) // Serve HTML

	// Static Files (CSS, JS, Images)
	staticFS := http.FileServer(http.Dir("static"))
	mux.Handle("/static/", http.StripPrefix("/static/", staticFS))

	// Local Audio Assets
	assetsAudioFS := http.FileServer(http.Dir("assets/audio"))
	mux.Handle("/assets/audio/", http.StripPrefix("/assets/audio/", assetsAudioFS))

	// API Endpoints
	mux.HandleFunc("/api/songs", songsAPIHandler)            // Get current internal playlist
	mux.HandleFunc("/api/jamendo/search", jamendoSearchHandler) // Search Jamendo

	// --- Server Start ---
	loggedMux := httpLogger(mux)
	port := os.Getenv("PORT"); if port == "" { port = "8080" }
	serverAddr := ":" + port
	log.Info().Str("address", "http://localhost:"+port).Msg("Server starting")
	server := &http.Server{Addr: serverAddr, Handler: loggedMux, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 120 * time.Second}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed { log.Fatal().Err(err).Msg("Server error") }
}

// --- HTTP Handlers ---

func indexHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" { http.NotFound(w, r); return }
	err := tmpl.Execute(w, nil)
	if err != nil { log.Error().Err(err).Msg("Template execute error"); http.Error(w, "Internal Server Error", 500) }
}

// Returns the current internal playlist (local + uploaded + added from API)
func songsAPIHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet { http.Error(w, "Method Not Allowed", 405); return }
	w.Header().Set("Content-Type", "application/json")
	// Encode the global currentInternalPlaylist
	if err := json.NewEncoder(w).Encode(currentInternalPlaylist); err != nil {
		log.Error().Err(err).Msg("Error encoding internal playlist")
	}
}

// Handles searching the Jamendo API
func jamendoSearchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet { http.Error(w, "Method Not Allowed", 405); return }

	query := r.URL.Query().Get("query")
	if query == "" { http.Error(w, "Missing search query", 400); return }

	// --- Jamendo Client ID ---
	// IMPORTANT: Use environment variables in production!
	// clientID := os.Getenv("JAMENDO_CLIENT_ID")
	clientID := "5a074d04" // Hardcoded from your image for this example ONLY.
	if clientID == "" {
		log.Error().Msg("JAMENDO_CLIENT_ID not configured")
		http.Error(w, "Server configuration error", 500)
		return
	}
	// -------------------------

	apiURL := fmt.Sprintf("https://api.jamendo.com/v3.0/tracks/?client_id=%s&format=json&limit=50&search=%s&imagesize=300", // Request a decent image size
		clientID,
		url.QueryEscape(query),
	)

	log.Info().Str("query", query).Msg("Calling Jamendo API")

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", apiURL, nil)
    if err != nil { log.Error().Err(err).Msg("Failed create Jamendo req"); http.Error(w,"API Error",500); return }
    req.Header.Set("Accept", "application/json") // Explicitly ask for JSON

	resp, err := client.Do(req)
	if err != nil { log.Error().Err(err).Msg("Failed Jamendo API call"); http.Error(w, "API Error", 502); return }
	defer resp.Body.Close()

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil { log.Error().Err(err).Msg("Failed read Jamendo resp"); http.Error(w, "API Error", 500); return }

	if resp.StatusCode != http.StatusOK {
		log.Error().Int("status", resp.StatusCode).Str("body", string(body)).Msg("Jamendo API non-OK")
		http.Error(w, fmt.Sprintf("Jamendo API Error (%d)", resp.StatusCode), 502)
		return
	}

	var jamendoResp JamendoResponse
	if err := json.Unmarshal(body, &jamendoResp); err != nil {
		log.Error().Err(err).Str("body", string(body)).Msg("Failed parse Jamendo JSON resp");
		http.Error(w, "API Parse Error", 500);
		return
	}

	if jamendoResp.Headers.Status != "success" {
		log.Error().Interface("headers", jamendoResp.Headers).Msg("Jamendo API reported non-success")
		http.Error(w, "Jamendo API request failed", 502)
		return
	}

	// Transform Jamendo results into our Song struct
	var results []Song
	for _, track := range jamendoResp.Results {
		filePath := track.Audio // Prefer standard quality stream
		if filePath == "" { filePath = track.AudioDownload } // Fallback
		if filePath == "" { continue } // Skip if no audio URL

		// Jamendo image URLs might be dynamically sized, check docs if specific size needed
		coverPath := track.Image
		if coverPath == "" { coverPath = "/static/images/default-cover.jpg"} // Fallback cover

		song := Song{
			ID:        fmt.Sprintf("jamendo-%s", track.ID), // Unique ID
			Title:     track.Name,
			Artist:    track.ArtistName,
			Album:     track.AlbumName,
			FilePath:  filePath,  // <<< PLAYABLE URL
			CoverPath: coverPath, // Image URL
			IsLocal:   false,     // Mark as API result
			Duration:  track.Duration, // Duration in seconds
		}
		results = append(results, song)
	}

	log.Info().Int("count", len(results)).Str("query", query).Msg("Jamendo search yielded results")
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(results); err != nil {
		log.Error().Err(err).Msg("Error encoding Jamendo results")
	}
}