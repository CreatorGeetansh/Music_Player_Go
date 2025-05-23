document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded. Starting Harmony Web Player JS (Auth, DB, Jamendo)...");

    // --- DOM Elements (Existing & New Auth) ---
    const audioPlayer = document.getElementById('audioPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progressBar = document.getElementById('progressBar');
    const currentTimeDisplay = document.getElementById('currentTime');
    const totalDurationDisplay = document.getElementById('totalDuration');
    const nowPlayingAlbumArt = document.getElementById('nowPlayingAlbumArt');
    const nowPlayingTitleDisplay = document.getElementById('nowPlayingTitle');
    const nowPlayingArtistDisplay = document.getElementById('nowPlayingArtist');
    const sidebarPlaylistElement = document.getElementById('sidebarPlaylist');
    const mainContentPlaylistTracksElement = document.getElementById('mainContentPlaylistTracks');
    const mainPlaylistTitleElement = document.getElementById('mainPlaylistTitle');
    const likeBtn = document.getElementById('likeBtn'); // Footer like button
    const shuffleBtn = document.getElementById('shuffleBtn');
    const repeatBtn = document.getElementById('repeatBtn');
    const volumeIconBtn = document.getElementById('volumeIconBtn');
    const volumeIcon = document.getElementById('volumeIcon');
    const volumeSlider = document.getElementById('volumeSlider');
    const uploadTrigger = document.getElementById('uploadTrigger'); // Sidebar upload button
    const uploadModalContainer = document.getElementById('uploadModalContainer');
    const closeUploadModalBtn = document.getElementById('closeUploadModalBtn');
    const fileUploadInput = document.getElementById('fileUploadInput');
    const dropZone = document.getElementById('dropZone');
    const uploadProgressList = document.getElementById('uploadProgressList');
    const jamendoSearchInput = document.getElementById('jamendoSearchInput');
    const jamendoSearchButton = document.getElementById('jamendoSearchButton');
    const homeNavItem = document.getElementById('homeNavItem'); // Ensure ID is on Home <li>
    const likedSongsNavItem = document.getElementById('likedSongsNavItem'); // Ensure ID is on Liked Songs <li>

    // Auth Modal Elements
    const loginModalContainer = document.getElementById('loginModalContainer');
    const registerModalContainer = document.getElementById('registerModalContainer');
    const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
    const closeRegisterModalBtn = document.getElementById('closeRegisterModalBtn');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginErrorMessage = document.getElementById('loginErrorMessage');
    const registerErrorMessage = document.getElementById('registerErrorMessage');
    const switchToRegister = document.getElementById('switchToRegister');
    const switchToLogin = document.getElementById('switchToLogin');

    // Auth Header Elements
    const loginTriggerBtn = document.getElementById('loginTriggerBtn');
    const registerTriggerBtn = document.getElementById('registerTriggerBtn');
    const guestView = document.getElementById('guestView');
    const userLoggedInView = document.getElementById('userLoggedInView');
    const loggedInUsernameDisplay = document.getElementById('loggedInUsernameDisplay');
    const logoutBtn = document.getElementById('logoutBtn');

    // --- State ---
    let currentUser = null; // Holds { userId: ..., username: ... } if logged in
    let currentInternalPlaylist = []; // Holds combined list from server (samples, uploads, liked Jamendo)
    let displayedPlaylist = [];       // What's currently shown in the main view
    let currentTrackIndex = -1;       // Index relative to displayedPlaylist
    let isPlaying = false;
    let isShuffleActive = false;
    let repeatMode = 0; // 0: none, 1: one, 2: all
    let currentView = 'internal'; // 'internal', 'search', 'liked'
    let likedSongIds = new Set(); // Store IDs of liked songs for quick lookup

    const DEFAULT_COVER = '/static/images/default-cover.jpg';

    // --- Utility Functions ---
    function formatTime(secondsRaw) { const sec = Math.floor(secondsRaw || 0); const min = Math.floor(sec / 60); const rem = sec % 60; return `${min}:${rem < 10 ? '0' : ''}${rem}`; }
    function displayApiError(element, error) { if (element) element.textContent = error.message || (typeof error === 'string' ? error : 'An unknown error occurred.');}
    function clearApiError(element) { if(element) element.textContent = ''; }

    // --- API Helper ---
    async function fetchAPI(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (e) {
                    // If response is not JSON, use status text
                    throw new Error(response.statusText || `HTTP error! Status: ${response.status}`);
                }
                throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
            }
            // If DELETE or other methods that might not return JSON but are OK
            if (response.status === 204 || response.headers.get("content-length") === "0") {
                return null; // Or some success indicator
            }
            return await response.json();
        } catch (error) {
            console.error(`API Error (${options.method || 'GET'} ${url}):`, error);
            throw error; // Re-throw to be caught by caller
        }
    }


    // --- Authentication UI & Logic ---
    function openLoginModal() { if (loginModalContainer) loginModalContainer.classList.add('active'); if (registerModalContainer) registerModalContainer.classList.remove('active'); clearApiError(loginErrorMessage); }
    function closeLoginModal() { if (loginModalContainer) loginModalContainer.classList.remove('active'); }
    function openRegisterModal() { if (registerModalContainer) registerModalContainer.classList.add('active'); if (loginModalContainer) loginModalContainer.classList.remove('active'); clearApiError(registerErrorMessage); }
    function closeRegisterModal() { if (registerModalContainer) registerModalContainer.classList.remove('active'); }

    function updateAuthUI() {
        if (currentUser && currentUser.username) {
            if (guestView) guestView.style.display = 'none';
            if (userLoggedInView) userLoggedInView.style.display = 'flex';
            if (loggedInUsernameDisplay) loggedInUsernameDisplay.textContent = currentUser.username;
            if (uploadTrigger) uploadTrigger.style.display = 'flex'; // Show upload
        } else {
            if (guestView) guestView.style.display = 'flex';
            if (userLoggedInView) userLoggedInView.style.display = 'none';
            if (loggedInUsernameDisplay) loggedInUsernameDisplay.textContent = '';
            if (uploadTrigger) uploadTrigger.style.display = 'none'; // Hide upload
        }
        fetchInitialPlaylist(); // Refresh playlist based on new auth state
    }

    async function checkAuthState() {
        try {
            const userData = await fetchAPI('/auth/me');
            currentUser = userData; // userData will be null if request fails (handled by fetchAPI)
            console.log("AUTH: User state checked:", currentUser);
        } catch (error) {
            // This means /auth/me returned an error (e.g., 401 Unauthorized)
            currentUser = null;
            console.log("AUTH: User not authenticated or session expired.");
        }
        updateAuthUI();
    }

    async function handleLogin(e) {
        e.preventDefault();
        clearApiError(loginErrorMessage);
        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData.entries());
        try {
            const result = await fetchAPI('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            console.log("Login success:", result);
            closeLoginModal();
            await checkAuthState(); // Update currentUser and UI
        } catch (error) {
            displayApiError(loginErrorMessage, error);
        }
    }

    async function handleRegister(e) {
        e.preventDefault();
        clearApiError(registerErrorMessage);
        const password = registerForm.querySelector('#registerPassword').value;
        const confirmPassword = registerForm.querySelector('#registerConfirmPassword').value;
        if (password !== confirmPassword) {
            displayApiError(registerErrorMessage, "Passwords do not match.");
            return;
        }
        const formData = new FormData(registerForm);
        const data = Object.fromEntries(formData.entries());
        delete data.confirmPassword;

        try {
            await fetchAPI('/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            closeRegisterModal();
            alert('Registration successful! Please login.');
            openLoginModal();
        } catch (error) {
            displayApiError(registerErrorMessage, error);
        }
    }

    async function handleLogout() {
        try {
            await fetchAPI('/auth/logout', { method: 'POST' });
            currentUser = null;
            updateAuthUI(); // This also calls fetchInitialPlaylist for guest
        } catch (error) {
            alert("Logout failed. Please try again. Error: " + error.message);
        }
    }


    // --- Core Player & Playlist Logic (Adapted for Auth) ---
    async function fetchInitialPlaylist() {
        console.log("PLAYER: Fetching playlist (auth aware)...");
        try {
            const serverPlaylist = await fetchAPI('/api/songs'); // Backend handles auth state
            console.log("PLAYER: Received playlist from server:", serverPlaylist);

            currentInternalPlaylist = (serverPlaylist || []).map(song => ({
                ...song,
                id: String(song.id), // Ensure ID is string
            }));

            likedSongIds.clear();
            currentInternalPlaylist.forEach(song => {
                if (song.isLiked) likedSongIds.add(String(song.id));
            });

            // Determine what to display (preserve view or default)
            const viewToRefresh = currentView || 'internal';
            switchToView(viewToRefresh, -1, true); // -1 to not auto-select, true to force playlist update

            // Auto-load first track if list is not empty and nothing is playing, or if current track is gone
            const currentAudioSrc = audioPlayer.currentSrc || audioPlayer.src;
            let shouldLoadNewTrack = true;
            if(displayedPlaylist && displayedPlaylist.length > 0) {
                if (currentAudioSrc && currentTrackIndex !== -1 && currentTrackIndex < displayedPlaylist.length) {
                    const currentPlayingInfo = displayedPlaylist[currentTrackIndex];
                     if (currentPlayingInfo && (currentPlayingInfo.filePath === currentAudioSrc || currentPlayingInfo.objectURL === currentAudioSrc) ) {
                        shouldLoadNewTrack = false; // Current track is still valid and playing/paused
                    }
                }
                if (shouldLoadNewTrack) {
                    loadTrack(displayedPlaylist, 0, false); // Load first, don't auto-play
                } else {
                    // Ensure UI (like active class) is correct for the currently loaded track
                    renderMainContentPlaylistTracks(displayedPlaylist, currentTrackIndex);
                }
            } else {
                updateNowPlayingBarUI(null); // Clear player bar if playlist is empty
                 renderMainContentPlaylistTracks([], -1); // Show empty message for current view
            }
            renderSidebarPlaylist(); // Always update sidebar
        } catch (error) {
            console.error("PLAYER: Could not fetch playlist:", error);
            alert("Error fetching your playlist: " + error.message);
            currentInternalPlaylist = []; displayedPlaylist = [];
            updateNowPlayingBarUI(null); renderAllPlaylistsUI();
        }
    }


    function updateNowPlayingBarUI(song) {
        // ... (same as your original - updates title, artist, cover) ...
        const title = song ? (song.title || "Unknown Track") : "No Song Loaded";
        const artist = song ? (song.artist || "---") : "---";
        const cover = song ? (song.coverPath || DEFAULT_COVER) : DEFAULT_COVER;
        if (nowPlayingTitleDisplay) nowPlayingTitleDisplay.textContent = title;
        if (nowPlayingArtistDisplay) nowPlayingArtistDisplay.textContent = artist;
        if (nowPlayingAlbumArt) { nowPlayingAlbumArt.src = cover; nowPlayingAlbumArt.onerror = () => { if (nowPlayingAlbumArt) nowPlayingAlbumArt.src = DEFAULT_COVER; }; }

        if (likeBtn) {
            const isLikedCurrent = song ? likedSongIds.has(String(song.id)) : false;
            likeBtn.classList.toggle('active', isLikedCurrent);
            const icon = likeBtn.querySelector('i');
            if (icon) icon.className = `fa-${isLikedCurrent ? 'solid' : 'regular'} fa-heart`;
        }
    }

    function loadTrack(playlistSource, index, playWhenLoaded = true) {
        // ... (mostly same logic as your original) ...
        // Ensure playlistSource is valid and index is in bounds
        if (!playlistSource || index < 0 || index >= playlistSource.length) {
            console.error("PLAYER: Invalid playlist source or index for loadTrack.", playlistSource, index);
            if (playlistSource && playlistSource.length > 0 && index >= playlistSource.length) { // Try to load first if index out of bounds
                index = 0;
            } else {
                updateNowPlayingBarUI(null); // Clear bar if cannot load
                if(audioPlayer && !audioPlayer.paused) audioPlayer.pause();
                isPlaying = false; updatePlayPauseButtonVisualState();
                return;
            }
        }
        if (!audioPlayer) return;
        if (!audioPlayer.paused) audioPlayer.pause();

        currentTrackIndex = index; // Relative to playlistSource (which should be displayedPlaylist)
        const trackToLoad = playlistSource[currentTrackIndex];
        if (!trackToLoad) { console.error("Track not found at index", currentTrackIndex); return; }

        updateNowPlayingBarUI(trackToLoad);

        let newSrc = trackToLoad.filePath || trackToLoad.objectURL; // objectURL for fresh uploads
        let isPlayable = !!newSrc;

        console.log(`PLAYER: Determined newSrc:"${newSrc}", isPlayable:${isPlayable}`);

        if (isPlayable && newSrc) {
            if (!audioPlayer.src || audioPlayer.src !== newSrc || audioPlayer.readyState === 0) {
                audioPlayer.src = newSrc; audioPlayer.load();
            }
            if (playWhenLoaded) {
                const playPromise = audioPlayer.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => { isPlaying = true; }).catch(e => { console.error("Play() error:", e); isPlaying = false; alert(`Could not play ${trackToLoad.title}: ${e.message}`); }).finally(updatePlayPauseButtonVisualState);
                } else { isPlaying = true; /* For older browsers or if promise not returned */ }
            } else { isPlaying = false; }
        } else {
            console.warn("PLAYER: Track not playable or no source. Detaching.", trackToLoad);
            isPlaying = false;
            if (audioPlayer.src !== "") { audioPlayer.removeAttribute('src'); audioPlayer.load(); }
        }
        updatePlayPauseButtonVisualState();
        renderMainContentPlaylistTracks(displayedPlaylist, currentTrackIndex); // Highlight active
        renderSidebarPlaylist();
    }

    // --- togglePlayPause, updatePlayPauseButtonVisualState, playNext, playPrev, progress updates, metadata loaded ---
    // (These functions from your original JS can largely remain the same, ensure they use `displayedPlaylist`)
    function togglePlayPause() { /* ... (Your existing logic, ensure it uses displayedPlaylist and handles loadTrack if needed) ... */
        if (!audioPlayer) return;
        const track = displayedPlaylist[currentTrackIndex];
        if(!track && currentInternalPlaylist.length > 0){ loadTrack(currentInternalPlaylist, 0, true); return; } // Fallback to internal if displayed is somehow empty
        if(!track) { if(uploadTrigger && currentUser) openUploadModal(); else if (!currentUser) openLoginModal(); return; }

        if(audioPlayer.paused || audioPlayer.ended){
            let expectedSrc = track.filePath || track.objectURL;
            if(audioPlayer.src && (audioPlayer.currentSrc || audioPlayer.src) === expectedSrc) {
                const p=audioPlayer.play(); if(p)p.then(()=>isPlaying=true).catch(e=>{console.error("Play err:",e);isPlaying=false; alert("Error playing: " + e.message);}).finally(updatePlayPauseButtonVisualState);
            } else { loadTrack(displayedPlaylist, currentTrackIndex, true); }
        } else {
            audioPlayer.pause(); isPlaying = false; updatePlayPauseButtonVisualState();
        }
    }
    function updatePlayPauseButtonVisualState() { if(!playPauseBtn||!audioPlayer)return; const i=playPauseBtn.querySelector('i');if(!i)return; if(!audioPlayer.paused&&isPlaying){i.className='fa-solid fa-pause';playPauseBtn.ariaLabel='Pause';}else{i.className='fa-solid fa-play';playPauseBtn.ariaLabel='Play';}}
    function playNextTrackLogic() { if(displayedPlaylist.length===0)return; let nextIdx; if(isShuffleActive){/* Implement shuffle logic */}else{nextIdx=(currentTrackIndex+1); if(nextIdx>=displayedPlaylist.length){if(repeatMode===2){nextIdx=0;}else{console.log("End of playlist.");isPlaying=false;updatePlayPauseButtonVisualState();return;}}} loadTrack(displayedPlaylist,nextIdx,true); }
    function playPrevTrackLogic() { if(displayedPlaylist.length===0)return; let prevIdx=(currentTrackIndex-1+displayedPlaylist.length)%displayedPlaylist.length; loadTrack(displayedPlaylist,prevIdx,true); }
    function updateProgressBarOnTimeUpdate() { if(!audioPlayer||!progressBar||!currentTimeDisplay)return;if(isFinite(audioPlayer.duration)){progressBar.value=audioPlayer.currentTime;currentTimeDisplay.textContent=formatTime(audioPlayer.currentTime);}else{progressBar.value=0;currentTimeDisplay.textContent=formatTime(0);} }
    function handleAudioMetadataLoaded() { if(!audioPlayer||!progressBar||!totalDurationDisplay)return;console.log(`Metadata loaded. Duration:${audioPlayer.duration}`);if(isFinite(audioPlayer.duration)){totalDurationDisplay.textContent=formatTime(audioPlayer.duration);progressBar.max=audioPlayer.duration;}else{totalDurationDisplay.textContent="--:--";progressBar.max=0;}updatePlayPauseButtonVisualState();}


    // --- Playlist Rendering (Adapted) ---
    function renderAllPlaylistsUI() { renderSidebarPlaylist(); renderMainContentPlaylistTracks(displayedPlaylist, currentTrackIndex); }

    function renderSidebarPlaylist() { // Renders from currentInternalPlaylist
        if (!sidebarPlaylistElement) return;
        sidebarPlaylistElement.innerHTML = '';
        // Filter for display: only show user's uploads and non-Jamendo liked songs in sidebar "queue"
        const sidebarDisplayable = currentInternalPlaylist.filter(s => s.isLocal || (s.isUploaded && s.userId === currentUser?.userId) || (likedSongIds.has(s.id) && !s.id.startsWith("jamendo-")));

        sidebarDisplayable.forEach((song, indexInSidebarList) => {
            const li = document.createElement('li');
            // Find original index in currentInternalPlaylist for consistent playing
            const originalInternalIndex = currentInternalPlaylist.findIndex(s_orig => s_orig.id === song.id);
            li.dataset.internalIndex = originalInternalIndex; // Use original index from full internal list
            li.dataset.id = song.id;

            const currentlySelectedTrackInMain = displayedPlaylist[currentTrackIndex];
            if (currentView === 'internal' && currentlySelectedTrackInMain && currentlySelectedTrackInMain.id === song.id) {
                li.classList.add('active');
            }
            li.innerHTML = `<span class="title">${song.title}</span><span class="artist">${song.artist}</span>`;
            li.addEventListener('click', () => { switchToView('internal', originalInternalIndex); });
            sidebarPlaylistElement.appendChild(li);
        });
    }

    function renderMainContentPlaylistTracks(sourcePlaylistToRender, activeIndexInSource) {
        // ... (Your existing complex rendering logic) ...
        // Key changes:
        // 1. Check `song.isLiked` (already set by fetchInitialPlaylist) or `likedSongIds.has(song.id)` for like icon.
        // 2. Action buttons:
        //    - "Add to Queue": Only for search results if not in `currentInternalPlaylist`. (Adding from search means liking it, which adds it to server's song list if Jamendo and then appears in fetched internal list). Simpler: just make "like" add it.
        //    - "Remove from Queue":
        //        - If `song.isUploaded && song.userId === currentUser.userId`: Show a "Delete Upload" icon/text.
        //        - If `likedSongIds.has(song.id)` and not an owned upload: Show "Unlike" icon/text (or let the like button itself handle unliking).
        //        - Otherwise (e.g. a sample song or a Jamendo song not liked, just in queue from previous session): Show "Remove from client queue".
        //    - "Like/Unlike": Always present.
        if (!mainContentPlaylistTracksElement) return;
        mainContentPlaylistTracksElement.innerHTML = '';
        const listToRender = sourcePlaylistToRender || [];
        if (listToRender.length === 0) {
            mainContentPlaylistTracksElement.innerHTML = `<p class="empty-playlist-message">${currentView === 'search' ? 'No search results.' : (currentView === 'liked' ? 'No liked songs yet.' : (currentUser ? 'Playlist empty. Upload or like songs!' : 'Playlist empty. Login to manage songs.'))}</p>`; return;
        }
        listToRender.forEach((song, index) => {
            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';
            trackItem.dataset.index = index; trackItem.dataset.id = String(song.id);
            if (index === activeIndexInSource) trackItem.classList.add('active');

            const isLiked = likedSongIds.has(String(song.id));
            const likeIconClass = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            const likeBtnTitle = isLiked ? 'Unlike' : 'Like Song';
            const isOwner = currentUser && song.isUploaded && song.userId === currentUser.userId;

            let actionButtonsHTML = '';
            if (currentView === 'search' && !currentInternalPlaylist.some(s => s.id === song.id)) {
                // In search, "Add" is effectively "Like" which backend handles by adding to songs table if new
                // The main "like" button will handle this.
            } else if (isOwner) {
                 actionButtonsHTML += `<button class="action-btn delete-uploaded-track-btn" data-id="${song.id}" title="Delete Upload"><i class="fa-solid fa-trash-can"></i></button>`;
            } else if ( (currentView === 'internal' || currentView === 'liked') && !song.isLocal && !song.isUploaded) { // e.g. a Jamendo song in queue
                // If it's not liked, "remove" just removes from client queue (if we implement client-only queue)
                // For simplicity now, "remove" on non-owned, non-sample songs means "unlike" if liked.
                // If not liked, it shouldn't be in 'liked' view. If in 'internal' and not liked (e.g. from search, then view switch),
                // a generic remove from current view might be an option, but complicates state.
                // Let's assume liked songs are the main way non-local/non-uploaded songs persist in user's "internal" view from server.
            }


            actionButtonsHTML += `<button class="action-btn like-track-btn" data-id="${song.id}" title="${likeBtnTitle}"><i class="${likeIconClass}"></i></button>`;

            // ... (rest of your trackItem.innerHTML structure from original, using actionButtonsHTML)
             trackItem.innerHTML = `
                <div class="track-number"><span>${index + 1}</span><i class="fa-solid fa-play"></i></div>
                <div class="track-info">
                    <img src="${song.coverPath || DEFAULT_COVER}" alt="${song.title}" class="track-item-cover" onerror="this.src='${DEFAULT_COVER}';">
                    <div class="track-details"><div class="track-title">${song.title}</div><div class="track-artist">${song.artist}</div></div>
                </div>
                <div class="track-artist-main">${song.artist || '---'}</div>
                <div class="track-album">${song.album || (song.isUploaded ? 'My Uploads' : (song.isLocal ? 'Samples' : 'Jamendo'))}</div>
                <div class="track-duration">${song.duration ? formatTime(song.duration) : "--:--"}</div>
                <div class="track-actions">${actionButtonsHTML}</div>`;


            trackItem.addEventListener('click', (e) => {
                const targetButton = e.target.closest('.action-btn');
                if (targetButton) {
                    if (targetButton.classList.contains('like-track-btn')) {
                        toggleLikeSong(song.id);
                    } else if (targetButton.classList.contains('delete-uploaded-track-btn')) {
                        handleDeleteUploadedSong(song.id, song.title);
                    }
                    // Add other action button handlers if any
                } else {
                    // Click on the row itself -> play
                    loadTrack(listToRender, index, true);
                }
            });
            mainContentPlaylistTracksElement.appendChild(trackItem);
        });
    }

    // --- Playlist Management (Interacting with Backend) ---
    async function toggleLikeSong(songIdToToggle) {
        // ... (Your existing toggleLikeSong from JS, but ensure it uses fetchAPI and handles errors) ...
        // Example snippet:
        if (!currentUser) { alert("Please login to like songs."); openLoginModal(); return; }
        const songData = displayedPlaylist.find(s => String(s.id) === String(songIdToToggle)) || currentInternalPlaylist.find(s => String(s.id) === String(songIdToToggle));
        if (!songData) { console.error("Like Error: Song data not found for ID:", songIdToToggle); return; }

        const wasLiked = likedSongIds.has(String(songIdToToggle));
        const endpoint = wasLiked ? '/api/songs/unlike' : '/api/songs/like';
        const body = {
            songId: songData.id, // Backend uses this to find/update DB record
            // For 'like', backend needs full song info if it's a new Jamendo song
            title: songData.title, artist: songData.artist, album: songData.album,
            filePath: songData.filePath, coverPath: songData.coverPath, duration: songData.duration,
            isLocal: songData.isLocal, jamendoId: songData.jamendoId || (songData.id.startsWith('jamendo-') ? songData.id.substring(8) : null)
        };

        try {
            const result = await fetchAPI(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            console.log(`API: ${wasLiked ? 'Unliked' : 'Liked'} song ID: ${result.songId}`);
            // Optimistically update client-side state, or call fetchInitialPlaylist
            if (wasLiked) { likedSongIds.delete(String(result.songId)); } else { likedSongIds.add(String(result.songId)); }
            // Update the isLiked status in currentInternalPlaylist directly for immediate UI feedback if needed,
            // before full fetchInitialPlaylist completes (which is more robust).
            const internalSong = currentInternalPlaylist.find(s => s.id === result.songId);
            if(internalSong) internalSong.isLiked = !wasLiked;


            // Re-render relevant parts or the whole view
            const trackItemIcon = mainContentPlaylistTracksElement.querySelector(`.track-item[data-id="${result.songId}"] .like-track-btn i`);
            if(trackItemIcon) trackItemIcon.className = likedSongIds.has(String(result.songId)) ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            if (displayedPlaylist[currentTrackIndex]?.id === result.songId) updateNowPlayingBarUI(songData); // songData here will have old isLiked
            if (currentView === 'liked') switchToView('liked', -1, true); // Force refresh of liked view

        } catch (error) {
            alert(`Failed to ${wasLiked ? 'unlike' : 'like'} song: ${error.message}`);
        }
    }

    function getLikedSongsPlaylist() { return currentInternalPlaylist.filter(song => likedSongIds.has(String(song.id))); }

    async function handleFileUpload(files) {
        // ... (Your existing handleFileUpload, but use fetchAPI for the upload call) ...
        // Example snippet:
        if (!currentUser) { alert("Please login to upload songs."); openLoginModal(); return; }
        if (!files || files.length === 0) return;
        // ... (FormData setup as before) ...
        for (const file of Array.from(files)) {
            // ... (create progress LI) ...
            const formData = new FormData();
            formData.append('audioFile', file); /* ... other form data ... */
            try {
                const newSong = await fetchAPI('/api/songs/upload', { method: 'POST', body: formData }); // No Content-Type for FormData
                // ... (update progress LI, then call fetchInitialPlaylist) ...
                li.textContent = `Uploaded: ${newSong.title}`;
                fetchInitialPlaylist(); // Refresh to get the new server state
            } catch (error) {
                // ... (update progress LI with error) ...
                li.textContent = `Failed: ${file.name} - ${error.message}`; li.style.color = 'red';
            }
        }
    }

    async function handleDeleteUploadedSong(songId, songTitle) {
        if (!currentUser) { alert("Login required."); return; }
        if (!confirm(`Are you sure you want to permanently delete your uploaded song "${songTitle}"?`)) return;

        try {
            // Backend requires songId in query or body. Let's use query for DELETE.
            // Or if your handler expects POST for delete: method: 'POST', body: JSON.stringify({songId})
            await fetchAPI(`/api/songs/delete?id=${encodeURIComponent(songId)}`, { method: 'DELETE' });
            console.log("Song deleted:", songId);
            // Refresh playlist from server
            fetchInitialPlaylist();
            // If the deleted song was playing, stop playback
            if (audioPlayer.src && displayedPlaylist[currentTrackIndex]?.id === songId) {
                audioPlayer.pause(); audioPlayer.removeAttribute("src"); audioPlayer.load();
                updateNowPlayingBarUI(null); currentTrackIndex = -1;
            }
        } catch (error) {
            alert(`Failed to delete song: ${error.message}`);
        }
    }


    // --- View Switching (Adapted) ---
    function switchToView(viewType, targetIndex = 0, forcePlaylistUpdate = false) {
        console.log(`VIEW_SWITCH: To '${viewType}', targetIdx: ${targetIndex}, forceUpdate: ${forcePlaylistUpdate}`);
        currentView = viewType;
        let newDisplayedPlaylist = [];
        let newActiveIndex = -1;

        // Highlight active nav item
        document.querySelectorAll('.main-nav li.active, .library-item.active-view').forEach(el => el.classList.remove('active', 'active-view'));
        if (viewType === 'internal' && homeNavItem) homeNavItem.closest('li').classList.add('active'); // Assuming homeNavItem is inside an <li>
        else if (viewType === 'liked' && likedSongsNavItem) likedSongsNavItem.closest('li').classList.add('active');


        if (viewType === 'internal') {
            newDisplayedPlaylist = [...currentInternalPlaylist];
            if(mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = currentUser ? `${currentUser.username}'s Queue` : "Harmony Queue";
        } else if (viewType === 'liked') {
            newDisplayedPlaylist = getLikedSongsPlaylist();
            if(mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = "Liked Songs";
        } else if (viewType === 'search') {
            // displayedPlaylist is set by searchJamendo, so newDisplayedPlaylist will be that
            newDisplayedPlaylist = displayedPlaylist; // Keep existing search results if any
            if(mainPlaylistTitleElement && jamendoSearchInput.value) mainPlaylistTitleElement.textContent = `Search: "${jamendoSearchInput.value}"`;
            else if (mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = "Search Results";
        }

        // Determine active index in the new list
        if (targetIndex >= 0 && targetIndex < newDisplayedPlaylist.length) {
            newActiveIndex = targetIndex;
        } else if (newDisplayedPlaylist.length > 0) {
             // Try to find currently playing song in new list
            const currentAudioFile = audioPlayer.src;
            if (currentAudioFile) {
                const playingIndexInNewList = newDisplayedPlaylist.findIndex(s => (s.filePath || s.objectURL) === currentAudioFile);
                if (playingIndexInNewList !== -1) newActiveIndex = playingIndexInNewList;
                else newActiveIndex = 0; // Default to first if not found
            } else {
                newActiveIndex = 0; // Default to first if nothing was playing
            }
        } else {
            newActiveIndex = -1; // Empty list
        }


        if (forcePlaylistUpdate || displayedPlaylist !== newDisplayedPlaylist) { // Avoid re-assign if same array object
            displayedPlaylist = newDisplayedPlaylist;
        }
        currentTrackIndex = newActiveIndex;

        renderMainContentPlaylistTracks(displayedPlaylist, currentTrackIndex);

        // Update Now Playing bar (only if track selection changed or forced)
        if (currentTrackIndex !== -1 && currentTrackIndex < displayedPlaylist.length) {
            const currentAudioSrc = audioPlayer.currentSrc || audioPlayer.src;
            const selectedTrackSrc = displayedPlaylist[currentTrackIndex].filePath || displayedPlaylist[currentTrackIndex].objectURL;
            // Only update (which might imply reload by loadTrack indirectly) if necessary
             if (currentAudioSrc !== selectedTrackSrc || audioPlayer.paused || !isPlaying) {
                 // If just updating info for already playing track, updateNowPlayingBarUI is enough
                 // If track changed or needs to start, loadTrack is better.
                 // For now, just update the bar if it's a different view but same track might be playing
                 updateNowPlayingBarUI(displayedPlaylist[currentTrackIndex]);
             }
        } else {
            updateNowPlayingBarUI(null); // Clear bar if no track or empty list
        }
    }


    // --- Jamendo Search (Adapted) ---
    async function searchJamendo(query) {
        query = query.trim();
        if (!query) { switchToView('internal', 0, true); return; } // Revert to internal on empty query
        console.log(`SEARCH: Jamendo for: "${query}"`);
        if(mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = `Searching Jamendo for "${query}"...`;
        if(mainContentPlaylistTracksElement) mainContentPlaylistTracksElement.innerHTML = '<p class="empty-playlist-message">Searching...</p>';
        try {
            const searchResults = await fetchAPI(`/api/jamendo/search?query=${encodeURIComponent(query)}`);
            console.log("SEARCH: Received Jamendo results:", searchResults);
            displayedPlaylist = (searchResults || []).map(s => ({ ...s, id: String(s.id), isLocal: false })); // Ensure ID is string
            switchToView('search', -1, true); // Display search results, don't auto-select
            if (displayedPlaylist.length === 0 && mainContentPlaylistTracksElement) mainContentPlaylistTracksElement.innerHTML = `<p class="empty-playlist-message">No Jamendo results for "${query}".</p>`;
        } catch (error) {
            console.error("SEARCH: Failed:", error);
            if(mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = `Search Failed`;
            if(mainContentPlaylistTracksElement) mainContentPlaylistTracksElement.innerHTML = `<p class="empty-playlist-message" style="color:red;">Jamendo search failed: ${error.message}</p>`;
        }
    }

    // --- Attaching Event Listeners (Auth, Player, Upload, Search, Nav) ---
    console.log("--- Attaching Event Listeners ---");
    // Auth Modals & Header
    if (loginTriggerBtn) loginTriggerBtn.addEventListener('click', openLoginModal);
    if (registerTriggerBtn) registerTriggerBtn.addEventListener('click', openRegisterModal);
    if (closeLoginModalBtn) closeLoginModalBtn.addEventListener('click', closeLoginModal);
    if (closeRegisterModalBtn) closeRegisterModalBtn.addEventListener('click', closeRegisterModal);
    if (switchToRegister) switchToRegister.addEventListener('click', (e) => { e.preventDefault(); openRegisterModal(); });
    if (switchToLogin) switchToLogin.addEventListener('click', (e) => { e.preventDefault(); openLoginModal(); });
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Player Controls (your existing listeners)
    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
    if (nextBtn) nextBtn.addEventListener('click', playNextTrackLogic);
    if (prevBtn) prevBtn.addEventListener('click', playPrevTrackLogic);
    if (progressBar) progressBar.addEventListener('input', (e) => { if (audioPlayer?.duration && isFinite(audioPlayer.duration)) audioPlayer.currentTime = parseFloat(e.target.value); });
    if (volumeSlider && audioPlayer) { /* ... your volume listeners ... */ }
    if (volumeIconBtn && audioPlayer) { /* ... your mute listener ... */ }
    if (shuffleBtn) { /* ... your shuffle listener ... */ }
    if (repeatBtn) { /* ... your repeat listener ... */ }
    if(likeBtn && audioPlayer){ likeBtn.addEventListener('click', () => { const currentTrack = displayedPlaylist[currentTrackIndex]; if (currentTrack) toggleLikeSong(currentTrack.id); }); }

    // Audio Player Events (your existing listeners)
    if (audioPlayer) {
        audioPlayer.addEventListener('loadedmetadata', handleAudioMetadataLoaded);
        audioPlayer.addEventListener('timeupdate', updateProgressBarOnTimeUpdate);
        audioPlayer.addEventListener('play', () => { isPlaying = true; updatePlayPauseButtonVisualState(); });
        audioPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayPauseButtonVisualState(); });
        audioPlayer.addEventListener('ended', () => { console.log("PLAYER: Ended. Repeat:"+repeatMode); isPlaying = false; updatePlayPauseButtonVisualState(); if(repeatMode===1)loadTrack(displayedPlaylist,currentTrackIndex,true); else if(repeatMode===2 || isShuffleActive || currentTrackIndex<displayedPlaylist.length-1) playNextTrackLogic(); else console.log("PLAYER: End of playlist."); });
        audioPlayer.addEventListener('error', (e) => { console.error("Audio Player Error:", e, audioPlayer.error); alert(`Audio error: ${audioPlayer.error?.message || 'Unknown audio error'}. Check console.`); });
    } else console.error("CRITICAL: audioPlayer element not found!");

    // Upload Listeners (your existing listeners, ensure handleFileUpload is called)
    if (uploadTrigger) uploadTrigger.addEventListener('click', () => { if(currentUser) openUploadModal(); else openLoginModal();});
    if (closeUploadModalBtn) closeUploadModalBtn.addEventListener('click', closeUploadModal);
    if (fileUploadInput) fileUploadInput.addEventListener('change', (event) => handleFileUpload(event.target.files));
    if (dropZone) { /* ... your dropzone listeners if implemented ... */ }

    // Search Listeners (your existing listeners)
    if (jamendoSearchButton && jamendoSearchInput) {
        jamendoSearchButton.addEventListener('click', () => searchJamendo(jamendoSearchInput.value));
        jamendoSearchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchJamendo(jamendoSearchInput.value); });
    }

    // Sidebar Navigation
    if (homeNavItem) homeNavItem.closest('li').addEventListener('click', (e) => { e.preventDefault(); switchToView('internal'); });
    if (likedSongsNavItem) likedSongsNavItem.closest('li').addEventListener('click', (e) => { e.preventDefault(); if(currentUser) switchToView('liked'); else openLoginModal(); });
    // Add listeners for other nav items if they switch views (e.g., "Search", "Explore")

    // Keyboard shortcuts (your existing listener)
    document.addEventListener('keydown', (e) => { /* ... */ });

    // --- Initial Setup ---
    console.log("PLAYER: Initializing UI and Auth State...");
    if (volumeSlider && audioPlayer) audioPlayer.volume = parseFloat(volumeSlider.value); else if (audioPlayer) audioPlayer.volume = 0.8; // Default
    updatePlayPauseButtonVisualState();
    checkAuthState(); // This will fetch user status and then trigger playlist load

    console.log("main.js execution finished and fully initialized.");
});