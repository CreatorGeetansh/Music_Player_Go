package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// !! CHANGE THIS KEY IN PRODUCTION AND STORE SECURELY (e.g., ENV VAR) !!
var jwtKey = []byte("your_super_secret_and_long_jwt_signing_key_min_32_bytes")

type Claims struct {
	UserID   int    `json:"userId"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

func GenerateJWT(user *User) (string, time.Time, error) {
	expirationTime := time.Now().Add(24 * time.Hour)
	claims := &Claims{
		UserID:   user.ID,
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "harmony_web_player",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtKey)
	return tokenString, expirationTime, err
}

func ValidateJWTAndGetClaims(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtKey, nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

func SetAuthCookie(w http.ResponseWriter, tokenString string, expirationTime time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     "harmony_token",
		Value:    tokenString,
		Expires:  expirationTime,
		HttpOnly: true, // Important for security
		Path:     "/",
		SameSite: http.SameSiteLaxMode, // Or StrictMode
		// Secure: true, // Uncomment in production if using HTTPS
	})
}

func ClearAuthCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "harmony_token",
		Value:    "",
		Expires:  time.Now().Add(-time.Hour), // Expire in the past
		HttpOnly: true,
		Path:     "/",
		SameSite: http.SameSiteLaxMode,
		// Secure: true,
	})
}

func VerifyPassword(hashedPassword, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
	return err == nil
}