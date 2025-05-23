package main

import (
	"context"
	"net/http"

	"github.com/rs/zerolog/log"
)

type contextKey string

const UserContextKey contextKey = "userClaims"

func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("harmony_token")
		if err != nil {
			if err == http.ErrNoCookie {
				http.Error(w, "Unauthorized: No token provided", http.StatusUnauthorized)
				return
			}
			http.Error(w, "Bad request", http.StatusBadRequest)
			return
		}

		tokenStr := cookie.Value
		claims, err := ValidateJWTAndGetClaims(tokenStr)
		if err != nil {
			log.Warn().Err(err).Msg("Token validation failed")
			ClearAuthCookie(w) // Clear invalid cookie
			http.Error(w, "Unauthorized: Invalid token", http.StatusUnauthorized)
			return
		}

		// Add claims to context
		ctx := context.WithValue(r.Context(), UserContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Optional: Middleware to check auth but not require it (for /api/songs)
func TryAuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        cookie, err := r.Cookie("harmony_token")
        if err == nil && cookie.Value != "" {
            tokenStr := cookie.Value
            claims, err := ValidateJWTAndGetClaims(tokenStr)
            if err == nil && claims != nil {
                ctx := context.WithValue(r.Context(), UserContextKey, claims)
                r = r.WithContext(ctx)
            }
        }
        next.ServeHTTP(w, r)
    })
}

func GetClaimsFromContext(r *http.Request) *Claims {
    claims, ok := r.Context().Value(UserContextKey).(*Claims)
    if !ok {
        return nil
    }
    return claims
}