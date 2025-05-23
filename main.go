package main

import (
	"html/template"
	"net/http"
	"os"
	"time"
	"fmt"
    "path/filepath"
    "github.com/joho/godotenv"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	// "github.com/gorilla/mux" // If you choose to use Gorilla Mux
)

var tmpl *template.Template

// Logging middleware from your original main.go
type loggingResponseWriter struct { http.ResponseWriter; statusCode int }
func newLoggingResponseWriter(w http.ResponseWriter) *loggingResponseWriter { return &loggingResponseWriter{w, http.StatusOK} }
func (lrw *loggingResponseWriter) WriteHeader(code int) { lrw.statusCode = code; lrw.ResponseWriter.WriteHeader(code) }
func httpLogger(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now(); lrw := newLoggingResponseWriter(w); handler.ServeHTTP(lrw, r); duration := time.Since(start)
		var event *zerolog.Event; if lrw.statusCode >= 500 { event = log.Error() } else if lrw.statusCode >= 400 { event = log.Warn() } else { event = log.Info() }
		event.Str("method", r.Method).Str("path", r.URL.Path).Int("status_code", lrw.statusCode).Dur("duration", duration).Msg("HTTP request")
	})
 }


func main() {
	// Logger Setup (from your original main.go)
	err := godotenv.Load() // Loads .env file by default
    if err != nil {
        log.Info().Msg("Note: .env file not found, relying on system environment variables")
    }

	logLevelStr := os.Getenv("LOG_LEVEL"); logLevel, err := zerolog.ParseLevel(logLevelStr); if err != nil || logLevelStr == "" { logLevel = zerolog.InfoLevel }
	var appLogger zerolog.Logger; if os.Getenv("APP_ENV") == "production" { appLogger = zerolog.New(os.Stdout).Level(logLevel).With().Timestamp().Logger() } else { output := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}; appLogger = zerolog.New(output).Level(logLevel).With().Timestamp().Caller().Logger() }
	log.Logger = appLogger; log.Info().Msg("Logger initialized.")

	
	// Database Initialization
	// IMPORTANT: Use environment variables for DSN in production
	dbUser := os.Getenv("DB_USER")          // e.g., root
	dbPassword := os.Getenv("DB_PASSWORD")  // e.g., mysecretpassword
	dbHost := os.Getenv("DB_HOST")          // e.g., 127.0.0.1
	dbPort := os.Getenv("DB_PORT")          // Default MySQL port
	dbName := os.Getenv("DB_NAME")          // e.g., harmony_web_db
	

	// Fallback to defaults if ENV vars not set (for easier local dev)
	if dbUser == "" { dbUser = "your_db_user" } // REPLACE
	if dbPassword == "" { dbPassword = "your_db_password" } // REPLACE
	if dbHost == "" { dbHost = "127.0.0.1" }
	if dbPort == "" { dbPort = "3306" }
	if dbName == "" { dbName = "harmony_web_db" }

	dataSourceName := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true",
		dbUser, dbPassword, dbHost, dbPort, dbName)
	InitDB(dataSourceName)

	// Templates
	tmpl, err = template.ParseFiles("templates/index.html")
	if err != nil { log.Fatal().Err(err).Msg("Error parsing HTML template") }

	// HTTP Router (using standard net/http.ServeMux)
	mux := http.NewServeMux()

	// Serve index.html
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" { http.NotFound(w, r); return }
		err := tmpl.Execute(w, nil)
		if err != nil { log.Error().Err(err).Msg("Template execute error"); http.Error(w, "Internal Server Error", 500) }
	})

	// Static Files (CSS, JS, Images)
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	mux.Handle("/assets/audio/", http.StripPrefix("/assets/audio/", http.FileServer(http.Dir("assets/audio"))))
    mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("uploads"))))


	// API Endpoints
    // Auth
	mux.HandleFunc("/auth/register", RegisterHandler)
	mux.HandleFunc("/auth/login", LoginHandler)
	mux.HandleFunc("/auth/logout", LogoutHandler) // No middleware, just clears cookie
    mux.Handle("/auth/me", AuthMiddleware(http.HandlerFunc(MeHandler))) // Get current user info


    // Songs - TryAuth allows guests to see samples, logged-in users see their stuff
	mux.Handle("/api/songs", TryAuthMiddleware(http.HandlerFunc(SongsAPIHandler)))
	mux.HandleFunc("/api/jamendo/search", JamendoSearchHandler) // Public search

    // Protected song actions
    mux.Handle("/api/songs/upload", AuthMiddleware(http.HandlerFunc(UploadSongHandler)))
    mux.Handle("/api/songs/like", AuthMiddleware(http.HandlerFunc(LikeSongHandler)))
    mux.Handle("/api/songs/unlike", AuthMiddleware(http.HandlerFunc(UnlikeSongHandler)))
    mux.Handle("/api/songs/delete", AuthMiddleware(http.HandlerFunc(DeleteSongHandler))) // Or /api/songs/{id} with DELETE method

	// Server Start
	loggedMux := httpLogger(mux) // Apply logging middleware
	port := os.Getenv("PORT"); if port == "" { port = "8080" }
	serverAddr := ":" + port
	log.Info().Str("address", "http://localhost:"+port).Msg("Server starting")

    // Create uploads directory if it doesn't exist
    uploadsDir := "./uploads"
    if _, err := os.Stat(uploadsDir); os.IsNotExist(err) {
        if err := os.MkdirAll(uploadsDir, 0755); err != nil {
            log.Fatal().Err(err).Msg("Failed to create uploads directory")
        }
        log.Info().Str("path", uploadsDir).Msg("Created uploads directory")
    } else {
         // Ensure it's a directory
        info, err := os.Stat(uploadsDir)
        if err != nil {
            log.Fatal().Err(err).Msgf("Failed to stat uploads directory: %s", uploadsDir)
        }
        if !info.IsDir() {
            log.Fatal().Msgf("Uploads path exists but is not a directory: %s", uploadsDir)
        }
        log.Info().Str("path", uploadsDir).Msg("Uploads directory already exists.")

        // Check write permissions (basic check)
        testFilePath := filepath.Join(uploadsDir, ".perm_test")
        if f, err := os.Create(testFilePath); err != nil {
            log.Warn().Err(err).Msgf("Failed to create test file in uploads directory. Check write permissions for: %s", uploadsDir)
        } else {
            f.Close()
            os.Remove(testFilePath)
            log.Info().Str("path", uploadsDir).Msg("Write permission confirmed for uploads directory.")
        }
    }


	server := &http.Server{
		Addr:         serverAddr,
		Handler:      loggedMux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal().Err(err).Msg("Server error")
	}
}