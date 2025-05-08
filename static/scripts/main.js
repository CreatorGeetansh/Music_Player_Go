document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded. Starting main.js (Jamendo + Like/Remove)...");

    // --- DOM Elements ---
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

    // Upload Modal
    const uploadTrigger = document.getElementById('uploadTrigger');
    const uploadModalContainer = document.getElementById('uploadModalContainer');
    const closeUploadModalBtn = document.getElementById('closeUploadModalBtn');
    const fileUploadInput = document.getElementById('fileUploadInput');
    const dropZone = document.getElementById('dropZone');
    const uploadProgressList = document.getElementById('uploadProgressList');

    // Search Elements
    const jamendoSearchInput = document.getElementById('jamendoSearchInput');
    const jamendoSearchButton = document.getElementById('jamendoSearchButton');

    // Sidebar Buttons
    const likedSongsNavItem = document.getElementById('likedSongsNavItem'); // Need to add this ID to your HTML li element
    const homeNavItem = document.getElementById('homeNavItem'); // Need to add this ID to your Home li element


    // --- State ---
    let currentInternalPlaylist = []; // Holds local, uploaded, and added Jamendo tracks
    let displayedPlaylist = [];       // What's currently shown (search results or internal list or liked list)
    let currentTrackIndex = -1;       // Index relative to displayedPlaylist
    let isPlaying = false;
    let isShuffleActive = false;
    let repeatMode = 0; // 0: none, 1: one, 2: all
    let currentView = 'internal'; // 'internal', 'search', 'liked' - Tracks current view type

    // Simple in-memory liked songs storage (use Set for efficient ID lookup)
    let likedSongIds = new Set();

    const DEFAULT_COVER = '/static/images/default-cover.jpg';

    // --- Utility Functions ---
    console.log("--- Checking Critical DOM Elements ---");
    function checkElement(id, el) { if (el) { console.log(`Element check: ID '${id}' FOUND.`); } else { console.error(`Element check: ID '${id}' NOT FOUND! Check HTML.`); } return el; }
    checkElement('audioPlayer', audioPlayer);
    checkElement('playPauseBtn', playPauseBtn);
    checkElement('jamendoSearchInput', jamendoSearchInput);
    checkElement('jamendoSearchButton', jamendoSearchButton);
    checkElement('sidebarPlaylist', sidebarPlaylistElement);
    checkElement('mainContentPlaylistTracks', mainContentPlaylistTracksElement);
    // Add checks for likeBtn, likedSongsNavItem, homeNavItem if you added those IDs
    console.log("--- DOM Element Check Complete ---");

    function formatTime(secondsRaw) { const sec=Math.floor(secondsRaw||0);const min=Math.floor(sec/60);const rem=sec%60;return `${min}:${rem<10?'0':''}${rem}`; }

    // --- Core Player & UI Update Functions ---
    async function fetchInitialPlaylist() {
        console.log("PLAYER: Fetching initial playlist...");
        // ... (rest of fetchInitialPlaylist is the same, populates currentInternalPlaylist)
        try {
            const response = await fetch('/api/songs');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const serverPlaylist = await response.json();
            console.log("PLAYER: Received initial playlist:", serverPlaylist);
            currentInternalPlaylist = serverPlaylist.map(song => ({ ...song, id: String(song.id), isLocal: true }));
            switchToView('internal'); // Set initial view and display playlist
            if (displayedPlaylist.length > 0) {
                loadTrack(displayedPlaylist, 0, false); // Load first, don't play
            } else { updateNowPlayingBarUI(null); }
        } catch (error) { console.error("PLAYER: Could not fetch initial playlist:", error); updateNowPlayingBarUI(null); }
    }

    function updateNowPlayingBarUI(song) {
        // ... (same basic logic) ...
        const title = song ? (song.title || "Unknown") : "No Song Loaded";
        const artist = song ? (song.artist || "---") : "---";
        const cover = song ? (song.coverPath || DEFAULT_COVER) : DEFAULT_COVER;
        if (nowPlayingTitleDisplay) nowPlayingTitleDisplay.textContent = title;
        if (nowPlayingArtistDisplay) nowPlayingArtistDisplay.textContent = artist;
        if (nowPlayingAlbumArt) { nowPlayingAlbumArt.src = cover; nowPlayingAlbumArt.onerror = ()=>{if(nowPlayingAlbumArt)nowPlayingAlbumArt.src=DEFAULT_COVER;}; }

        // Update footer like button state
        if (likeBtn) {
            const isLiked = song ? likedSongIds.has(song.id) : false;
            likeBtn.classList.toggle('active', isLiked);
            const icon = likeBtn.querySelector('i');
            if (icon) icon.className = `fa-${isLiked ? 'solid' : 'regular'} fa-heart`;
        }
    }

    function loadTrack(playlistSource, index, playWhenLoaded = true) {
        // ... (mostly same logic as last working version) ...
        console.log(`PLAYER: loadTrack. Source type: ${playlistSource === currentInternalPlaylist ? 'internal' : (playlistSource === displayedPlaylist ? 'displayed' : 'unknown')}. Index: ${index}. Play: ${playWhenLoaded}`);
        if (!audioPlayer) return;
        if (!audioPlayer.paused) audioPlayer.pause();

        const sourceArray = playlistSource;
        if (!sourceArray || index < 0 || index >= sourceArray.length) { console.error("PLAYER: Invalid source or index"); return; }

        currentTrackIndex = index;
        const trackToLoad = sourceArray[currentTrackIndex];
        if (!trackToLoad) return;

        console.log("PLAYER: Loading details:", trackToLoad);
        updateNowPlayingBarUI(trackToLoad); // Update bar based on selected track

        let newSrc = ""; let isPlayable = false;
        if (trackToLoad.isLocal) { newSrc = trackToLoad.objectURL || trackToLoad.filePath; isPlayable = !!newSrc; }
        else if (trackToLoad.filePath?.startsWith("http")) { newSrc = trackToLoad.filePath; isPlayable = true; } // Jamendo
        else { console.warn("PLAYER: Track not playable", trackToLoad); isPlayable = false; }

        console.log(`PLAYER: Determined newSrc:"${newSrc}", isPlayable:${isPlayable}`);

        if (isPlayable && newSrc) {
            let currentEffectiveSrc = audioPlayer.currentSrc || audioPlayer.src;
            if (!currentEffectiveSrc || currentEffectiveSrc !== newSrc || audioPlayer.readyState === 0) {
                console.log("PLAYER: Setting src and loading:", newSrc); audioPlayer.src = newSrc; audioPlayer.load();
            } else { console.log("PLAYER: Src already set."); }

            if (playWhenLoaded) {
                console.log("PLAYER: Attempting play:", audioPlayer.src);
                const p = audioPlayer.play(); if(p)p.then(()=>{isPlaying=true;}).catch(e=>{console.error("Play() error:",e);isPlaying=false;}).finally(updatePlayPauseButtonVisualState);
                else { isPlaying=false; updatePlayPauseButtonVisualState(); }
            } else { isPlaying=false; updatePlayPauseButtonVisualState(); }
        } else { // Not playable
            console.log("PLAYER: Track not playable. Detaching source."); isPlaying=false;
            if (audioPlayer.src !== "") { audioPlayer.removeAttribute('src'); audioPlayer.load(); }
            updatePlayPauseButtonVisualState();
        }
        // Ensure displayed playlist is rendered correctly highlighting the active track
        renderMainContentPlaylistTracks(displayedPlaylist, currentTrackIndex);
        renderSidebarPlaylist(); // Update sidebar (active state might change)
    }

    function togglePlayPause() { /* ... (same logic as last working version) ... */
        if (!audioPlayer) return;
        const track = displayedPlaylist[currentTrackIndex];
        if(!track && currentInternalPlaylist.length > 0){ loadTrack(currentInternalPlaylist, 0, true); return; }
        if(!track) { if(uploadTrigger) openUploadModal(); return; }
        const isSelPlayable = track.isLocal || track.filePath?.startsWith('http') || track.filePath?.startsWith('/assets/');
        const isSrcPlayable = audioPlayer.src && !audioPlayer.src.endsWith(window.location.host+"/");
        if(audioPlayer.paused || audioPlayer.ended){ // Try Play
            if(isSelPlayable){
                let expectedSrc = track.isLocal ? (track.objectURL || track.filePath) : track.filePath;
                if(isSrcPlayable && (audioPlayer.currentSrc || audioPlayer.src) === expectedSrc) {
                    const p=audioPlayer.play(); if(p)p.then(()=>isPlaying=true).catch(e=>{console.error("Play err:",e);isPlaying=false;}).finally(updatePlayPauseButtonVisualState);
                } else { loadTrack(displayedPlaylist, currentTrackIndex, true); }
            } else { console.warn("Cannot play non-playable track."); alert(`Info: ${track.title} cannot be played directly.`); isPlaying=false; updatePlayPauseButtonVisualState(); }
        } else { // Try Pause
             if (isSrcPlayable) audioPlayer.pause(); isPlaying = false; updatePlayPauseButtonVisualState();
        }
    }

    function updatePlayPauseButtonVisualState() { /* ... (same) ... */ if(!playPauseBtn||!audioPlayer)return; const i=playPauseBtn.querySelector('i');if(!i)return; if(!audioPlayer.paused&&isPlaying){i.className='fa-solid fa-pause';playPauseBtn.ariaLabel='Pause';}else{i.className='fa-solid fa-play';playPauseBtn.ariaLabel='Play';}}
    function playNextTrackLogic() { /* ... (same - uses displayedPlaylist) ... */ if(displayedPlaylist.length===0)return; let nextIdx; if(isShuffleActive){/*shuffle*/}else{nextIdx=currentTrackIndex+1; if(nextIdx>=displayedPlaylist.length){if(repeatMode===2)nextIdx=0;else{console.log("End.");isPlaying=false;updatePlayPauseButtonVisualState();return;}}} loadTrack(displayedPlaylist, nextIdx, true); }
    function playPrevTrackLogic() { /* ... (same - uses displayedPlaylist) ... */ if(displayedPlaylist.length===0)return; let prevIdx = (currentTrackIndex-1+displayedPlaylist.length)%displayedPlaylist.length; loadTrack(displayedPlaylist, prevIdx, true); }
    function updateProgressBarOnTimeUpdate() { /* ... (same) ... */ if(!audioPlayer||!progressBar||!currentTimeDisplay)return;if(isFinite(audioPlayer.duration)){progressBar.value=audioPlayer.currentTime;currentTimeDisplay.textContent=formatTime(audioPlayer.currentTime);}else{progressBar.value=0;currentTimeDisplay.textContent=formatTime(0);} }
    function handleAudioMetadataLoaded() { /* ... (same) ... */ if(!audioPlayer||!progressBar||!totalDurationDisplay)return;console.log(`Metadata loaded. Duration:${audioPlayer.duration}`);if(isFinite(audioPlayer.duration)){totalDurationDisplay.textContent=formatTime(audioPlayer.duration);progressBar.max=audioPlayer.duration;}else{totalDurationDisplay.textContent="--:--";progressBar.max=0;}updatePlayPauseButtonVisualState();}

    // --- Playlist Rendering ---
    function renderAllPlaylistsUI() {
        console.log("UI_UPDATE: Rendering views. Current view:", currentView);
        renderSidebarPlaylist();
        renderMainContentPlaylistTracks(displayedPlaylist, currentTrackIndex);
    }

    function renderSidebarPlaylist() { /* ... (same - renders currentInternalPlaylist) ... */
         if (!sidebarPlaylistElement) return; sidebarPlaylistElement.innerHTML = '';
         currentInternalPlaylist.forEach((song, internalIdx) => {
            const li = document.createElement('li'); li.dataset.internalIndex = internalIdx; li.dataset.id = song.id;
            const currentlySelectedTrack = displayedPlaylist[currentTrackIndex];
            // Highlight if internal song is selected *and* we are viewing the internal playlist
            if (currentView === 'internal' && currentlySelectedTrack && currentlySelectedTrack.id === song.id) {
                li.classList.add('active');
            }
            li.innerHTML = `<span class="title">${song.title}</span><span class="artist">${song.artist}</span>`;
            li.addEventListener('click', () => { switchToView('internal', internalIdx); }); // Switch to internal view and play this song
            sidebarPlaylistElement.appendChild(li);
        });
     }

    function renderMainContentPlaylistTracks(sourcePlaylistToRender, activeIndexInSource) {
        if (!mainContentPlaylistTracksElement) return;
        mainContentPlaylistTracksElement.innerHTML = '';
        if (!sourcePlaylistToRender || sourcePlaylistToRender.length === 0) {
            mainContentPlaylistTracksElement.innerHTML = `<p class="empty-playlist-message">${currentView === 'search' ? 'No search results.' : (currentView === 'liked' ? 'No liked songs yet.' : 'Playlist empty. Upload songs!')}</p>`; return;
        }
        sourcePlaylistToRender.forEach((song, index) => {
            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';
            trackItem.dataset.index = index; trackItem.dataset.id = song.id;
            if (index === activeIndexInSource) trackItem.classList.add('active');

            const isPlayableEntry = song.isLocal || song.filePath?.startsWith('http');
            let dynamicDuration = song.duration ? formatTime(song.duration) : (isPlayableEntry ? "--:--" : "N/A");
             if(isPlayableEntry && !song.duration && song.filePath){ /* ... async duration fetch ... */
                 const tempAudio = new Audio(song.filePath); tempAudio.onloadedmetadata = () => { if (isFinite(tempAudio.duration)) { const d=trackItem.querySelector('.track-duration'); if(d)d.textContent=formatTime(tempAudio.duration); }};
             }

            const isLiked = likedSongIds.has(song.id);
            const likeIconClass = isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            const likeBtnTitle = isLiked ? 'Unlike' : 'Like';

            // Only show Add/Remove buttons when viewing the internal or liked playlist
            let actionButtonsHTML = '';
            const isInInternalPlaylist = currentInternalPlaylist.some(s => s.id === song.id);

            if (currentView === 'search' && !isInInternalPlaylist) {
                // Show Add button only in search results if not already in internal list
                 actionButtonsHTML += `<button class="action-btn add-to-queue-btn" data-id="${song.id}" title="Add to Queue"><i class="fa-solid fa-plus"></i></button>`;
            } else if (currentView === 'internal' || currentView === 'liked') {
                 // Show Remove button when viewing internal or liked playlists
                 actionButtonsHTML += `<button class="action-btn remove-track-btn" data-id="${song.id}" data-index="${index}" title="Remove from Queue"><i class="fa-solid fa-trash-can"></i></button>`;
            }

            // Always show Like button
            actionButtonsHTML += `<button class="action-btn like-track-btn" data-id="${song.id}" title="${likeBtnTitle}"><i class="${likeIconClass}"></i></button>`;


            trackItem.innerHTML = `
                <div class="track-number"><span>${index + 1}</span><i class="fa-solid ${isPlayableEntry ? 'fa-play' : 'fa-info-circle'}"></i></div>
                <div class="track-info">
                    <img src="${song.coverPath || DEFAULT_COVER}" alt="${song.title}" class="track-item-cover" onerror="this.src='${DEFAULT_COVER}';">
                    <div class="track-details"><div class="track-title">${song.title}</div><div class="track-artist">${song.artist}</div></div>
                </div>
                <div class="track-artist-main">${song.artist || '---'}</div>
                <div class="track-album">${song.album || (song.isLocal ? 'Uploaded' : 'Jamendo')}</div>
                <div class="track-duration">${dynamicDuration}</div>
                <div class="track-actions">${actionButtonsHTML}</div>`; // Insert action buttons

            // Use event delegation on the parent for actions, or attach here
            trackItem.addEventListener('click', (e) => {
                 if (e.target.closest('.add-to-queue-btn')) {
                     addSongToInternalPlaylist(song); // song is from sourcePlaylistToRender
                     renderMainContentPlaylistTracks(sourcePlaylistToRender, activeIndexInSource); // Re-render to update btn state
                     renderSidebarPlaylist();
                 } else if (e.target.closest('.like-track-btn')) {
                     toggleLikeSong(song.id);
                     // Re-render this item or just update button state
                     const likeIcon = e.target.closest('.like-track-btn').querySelector('i');
                     const isNowLiked = likedSongIds.has(song.id);
                     if(likeIcon) likeIcon.className = `fa-${isNowLiked ? 'solid' : 'regular'} fa-heart`;
                     e.target.closest('.like-track-btn').title = isNowLiked ? 'Unlike' : 'Like';
                     // Update footer like button if this is the currently playing song
                     if (displayedPlaylist[currentTrackIndex]?.id === song.id) updateNowPlayingBarUI(song);
                     // If viewing liked songs, removing the like should remove it from view
                     if (currentView === 'liked' && !isNowLiked) {
                         switchToView('liked'); // Re-filter and render liked songs view
                     }

                 } else if (e.target.closest('.remove-track-btn')) {
                     removeSongFromInternalPlaylist(song.id, index); // Pass index from *this rendering*
                 } else {
                     // Click on the row itself (not an action button) -> play
                    loadTrack(sourcePlaylistToRender, index, true);
                 }
            });
            mainContentPlaylistTracksElement.appendChild(trackItem);
        });
     }

    // --- Playlist Management ---
    function addSongToInternalPlaylist(songToAdd) {
        if (!currentInternalPlaylist.some(s => s.id === songToAdd.id)) {
            currentInternalPlaylist.push({ ...songToAdd });
            console.log("PLAYLIST_MGMT: Added:", songToAdd.title);
            // Don't re-render sidebar here, let the calling context handle it if needed
        } else {
            console.log("PLAYLIST_MGMT: Already exists:", songToAdd.title);
        }
    }

    function removeSongFromInternalPlaylist(songIdToRemove, indexInDisplayedList) {
         console.log(`PLAYLIST_MGMT: Attempting to remove song ID ${songIdToRemove} which was at displayed index ${indexInDisplayedList}`);
         const initialInternalLength = currentInternalPlaylist.length;
         currentInternalPlaylist = currentInternalPlaylist.filter(song => song.id !== songIdToRemove);

         if (currentInternalPlaylist.length < initialInternalLength) {
             console.log("PLAYLIST_MGMT: Song removed successfully.");
             // Also remove from liked songs if it was liked
             if (likedSongIds.has(songIdToRemove)) {
                 likedSongIds.delete(songIdToRemove);
                 console.log("PLAYLIST_MGMT: Also removed from liked songs.");
             }

             // --- Handle playback state ---
             const currentlyPlayingTrack = displayedPlaylist[currentTrackIndex];
             let nextTrackIndex = currentTrackIndex; // Default to current index

             if (currentlyPlayingTrack && currentlyPlayingTrack.id === songIdToRemove) {
                 // We removed the currently playing song
                 console.log("PLAYLIST_MGMT: Removed currently playing song.");
                 audioPlayer.pause();
                 audioPlayer.removeAttribute("src");
                 audioPlayer.load();
                 isPlaying = false;
                 updateNowPlayingBarUI(null); // Clear player bar

                 // Decide what to play next (or if list is now empty)
                 if (currentInternalPlaylist.length === 0) {
                      console.log("PLAYLIST_MGMT: Internal playlist is now empty.");
                      displayedPlaylist = [];
                      currentTrackIndex = -1;
                 } else {
                      // Try to select the track that *was* at the same index, or the previous one if it was last
                      nextTrackIndex = Math.min(indexInDisplayedList, currentInternalPlaylist.length - 1);
                 }
             } else if (indexInDisplayedList < currentTrackIndex) {
                  // If we removed a song *before* the currently playing one, adjust the index
                  nextTrackIndex = currentTrackIndex - 1;
             } else {
                 // Removing a song after the current one doesn't change the current index
                 nextTrackIndex = currentTrackIndex;
             }


             // Update the displayed playlist based on the current view
             if (currentView === 'internal') {
                 displayedPlaylist = [...currentInternalPlaylist];
                 currentTrackIndex = nextTrackIndex; // Use the adjusted index
                 renderAllPlaylistsUI(); // Re-render everything
                 // Optionally auto-load the new current track if something was playing
                 // if(currentTrackIndex !== -1) loadTrack(displayedPlaylist, currentTrackIndex, false); // Load but don't auto-play
             } else if (currentView === 'liked') {
                 // Re-filter and display liked songs
                 switchToView('liked'); // This will re-render with the updated liked list
             }
              // If search view was active, removing from internal only affects sidebar

             renderSidebarPlaylist(); // Always update sidebar

         } else {
             console.warn("PLAYLIST_MGMT: Song ID not found in internal playlist for removal:", songIdToRemove);
         }
    }

    // --- Liked Songs Logic ---
    function toggleLikeSong(songId) {
        if (!songId) return;
        let wasLiked = likedSongIds.has(songId);
        if (wasLiked) {
            likedSongIds.delete(songId);
            console.log(`LIKED: Unliked song ID: ${songId}`);
        } else {
            likedSongIds.add(songId);
            console.log(`LIKED: Liked song ID: ${songId}`);
            // Ensure the song data exists in internal playlist if liking from search results
            const songData = displayedPlaylist.find(s => s.id === songId);
            if(songData && !currentInternalPlaylist.some(s => s.id === songId)) {
                addSongToInternalPlaylist(songData);
                renderSidebarPlaylist(); // Update sidebar if added
            }
        }
        // Update UI (buttons will be updated by render function or specific calls)
    }

    function getLikedSongsPlaylist() {
        // Filter the internal playlist to get full song objects for liked IDs
        return currentInternalPlaylist.filter(song => likedSongIds.has(song.id));
    }


    // --- View Switching ---
    function switchToView(viewType, targetIndex = 0) {
        console.log(`VIEW_SWITCH: Switching to '${viewType}' view.`);
        currentView = viewType;
        let activeIndex = -1; // Index relative to the *new* displayedPlaylist

        // Remove 'active-view' class from all sidebar items first
        document.querySelectorAll('.library-item.active-view, .main-nav li.active-view').forEach(el => el.classList.remove('active-view'));


        if (viewType === 'internal') {
            displayedPlaylist = [...currentInternalPlaylist];
            if(mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = "Your Playlist Queue";
            // Try to find the currently playing song or use targetIndex
            const currentTrack = audioPlayer.src ? currentInternalPlaylist.find(s => (s.isLocal?(s.objectURL||s.filePath):s.filePath) === audioPlayer.src) : null;
            activeIndex = currentTrack ? currentInternalPlaylist.indexOf(currentTrack) : (targetIndex < displayedPlaylist.length ? targetIndex : (displayedPlaylist.length > 0 ? 0 : -1));
            if(homeNavItem) homeNavItem.classList.add('active-view'); // Highlight Home
        } else if (viewType === 'liked') {
            displayedPlaylist = getLikedSongsPlaylist();
            if(mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = "Liked Songs";
            // Find if currently playing song is in the liked list
             const currentTrack = audioPlayer.src ? displayedPlaylist.find(s => (s.isLocal?(s.objectURL||s.filePath):s.filePath) === audioPlayer.src) : null;
             activeIndex = currentTrack ? displayedPlaylist.indexOf(currentTrack) : (targetIndex < displayedPlaylist.length ? targetIndex : (displayedPlaylist.length > 0 ? 0 : -1));
            if(likedSongsNavItem) likedSongsNavItem.classList.add('active-view'); // Highlight Liked Songs
        } else if (viewType === 'search') {
            // displayedPlaylist is already set by search function
            if(mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = `Search Results`; // Title set during search
             activeIndex = -1; // No specific track active when showing new results
        }

        currentTrackIndex = activeIndex;
        renderMainContentPlaylistTracks(displayedPlaylist, currentTrackIndex);

        // Update Now Playing bar to reflect the selected item in the new view, or clear it
        if(currentTrackIndex !== -1 && currentTrackIndex < displayedPlaylist.length) {
             // Don't reload/play, just update bar info IF the audio element isn't already playing this exact track
             const currentAudioSrc = audioPlayer.currentSrc || audioPlayer.src;
             const selectedTrackSrc = displayedPlaylist[currentTrackIndex].isLocal ? (displayedPlaylist[currentTrackIndex].objectURL || displayedPlaylist[currentTrackIndex].filePath) : displayedPlaylist[currentTrackIndex].filePath;
             if (currentAudioSrc !== selectedTrackSrc) {
                  updateNowPlayingBarUI(displayedPlaylist[currentTrackIndex]);
             }
        } else if (currentView !== 'search') { // Clear bar if view switched and no track selected, except for search
             updateNowPlayingBarUI(null);
        }
    }

    // --- Jamendo Search ---
    async function searchJamendo(query) { /* ... (same as before, but calls switchToView('search')) ... */
        query = query.trim(); if (!query) { switchToView('internal'); return; } // Revert to internal on empty query
        console.log(`SEARCH: Jamendo for: "${query}"`); if(mainPlaylistTitleElement) mainPlaylistTitleElement.textContent = `Search: "${query}"`; if(mainContentPlaylistTracksElement) mainContentPlaylistTracksElement.innerHTML = '<p class="empty-playlist-message">Searching...</p>';
        try {
            const response = await fetch(`/api/jamendo/search?query=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error(`Search API error! Status: ${response.status}`); const searchResults = await response.json(); console.log("SEARCH: Received Jamendo results:", searchResults);
            displayedPlaylist = searchResults.map(s => ({...s, isLocal: false}));
            switchToView('search'); // Set view type and render results
            if (searchResults.length === 0 && mainContentPlaylistTracksElement) mainContentPlaylistTracksElement.innerHTML = `<p class="empty-playlist-message">No results for "${query}".</p>`;
        } catch (error) { console.error("SEARCH: Failed:", error); if(mainContentPlaylistTracksElement) mainContentPlaylistTracksElement.innerHTML = `<p class="empty-playlist-message" style="color:red;">Search failed.</p>`; }
    }

    // --- File Upload ---
    function openUploadModal() { /* ... (same) ... */ if (uploadModalContainer) uploadModalContainer.classList.add('active'); }
    function closeUploadModal() { /* ... (same) ... */ if (uploadModalContainer) uploadModalContainer.classList.remove('active'); if(uploadProgressList) uploadProgressList.innerHTML = '';}
    function handleFileUpload(files) { /* ... (same - adds to currentInternalPlaylist, calls switchToView('internal')) ... */
        if (!files || files.length === 0) return; console.log("UPLOAD: Files:", files); if (uploadProgressList) uploadProgressList.innerHTML = ''; const newSongs = [];
        Array.from(files).forEach(file => { if (file.type.startsWith('audio/')) { const li=document.createElement('li');li.textContent=`Processing:${file.name}...`;if(uploadProgressList)uploadProgressList.appendChild(li); const objectURL=URL.createObjectURL(file); const newSong={id:`local-${Date.now()}-${Math.random().toString(36).substring(2,7)}`,title:file.name.replace(/\.[^/.]+$/,"")||"Uploaded",artist:"Local",album:"Uploads",filePath:objectURL,coverPath:DEFAULT_COVER,isLocal:true,objectURL:objectURL}; newSongs.push(newSong); li.textContent = `Added: ${newSong.title}`; } else { /* error item */ } });
        if (newSongs.length > 0) { const wasEmpty = currentInternalPlaylist.length === 0; currentInternalPlaylist.push(...newSongs);
            switchToView('internal', wasEmpty ? 0 : currentInternalPlaylist.length - newSongs.length); // Switch view, select first new song
            if (wasEmpty) { loadTrack(displayedPlaylist, 0, false); } // Load if list was empty
            else { updateNowPlayingBarUI(displayedPlaylist[currentTrackIndex]); } // Just update bar
        } if (fileUploadInput) fileUploadInput.value = '';
     }


    // --- Attaching Event Listeners ---
    console.log("--- Attaching Event Listeners ---");
    // Player Controls
    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause); else console.error("Listener skip: playPauseBtn");
    if (nextBtn) nextBtn.addEventListener('click', playNextTrackLogic); else console.error("Listener skip: nextBtn");
    if (prevBtn) prevBtn.addEventListener('click', playPrevTrackLogic); else console.error("Listener skip: prevBtn");
    if (progressBar) progressBar.addEventListener('input', (e) => { if (audioPlayer?.duration && isFinite(audioPlayer.duration)) audioPlayer.currentTime = parseFloat(e.target.value); }); else console.error("Listener skip: progressBar");
    if (volumeSlider && audioPlayer) { volumeSlider.addEventListener('input', (e) => { audioPlayer.volume = parseFloat(e.target.value); }); audioPlayer.addEventListener('volumechange', () => { volumeSlider.value = audioPlayer.volume; /* + icon update */ if(!volumeIcon)return; if(audioPlayer.muted||audioPlayer.volume===0)volumeIcon.className='fa-solid fa-volume-xmark';else if(audioPlayer.volume<0.5)volumeIcon.className='fa-solid fa-volume-low';else volumeIcon.className='fa-solid fa-volume-high'; }); } else console.error("Listener skip: volumeSlider/audioPlayer");
    if (volumeIconBtn && audioPlayer) volumeIconBtn.addEventListener('click', () => { audioPlayer.muted = !audioPlayer.muted; }); else console.error("Listener skip: volumeIconBtn/audioPlayer");
    if (shuffleBtn) shuffleBtn.addEventListener('click', () => { isShuffleActive = !isShuffleActive; shuffleBtn.classList.toggle('active', isShuffleActive); console.log("Shuffle:", isShuffleActive); }); else console.error("Listener skip: shuffleBtn");
    if (repeatBtn) { repeatBtn.addEventListener('click', () => { repeatMode = (repeatMode + 1) % 3; const i = repeatBtn.querySelector('i'); if(i){ repeatBtn.classList.toggle('active', repeatMode!==0); if(repeatMode===1) i.className='fa-solid fa-repeat-1'; else i.className='fa-solid fa-repeat';} console.log("Repeat:", repeatMode); }); } else console.error("Listener skip: repeatBtn");
    if(likeBtn && audioPlayer){ likeBtn.addEventListener('click', () => { const currentTrack = displayedPlaylist[currentTrackIndex]; if (currentTrack) toggleLikeSong(currentTrack.id); updateNowPlayingBarUI(currentTrack); }); } else console.error("Listener skip: likeBtn/audioPlayer"); // Footer like button

    // Audio Player Events
    if (audioPlayer) {
        audioPlayer.addEventListener('loadedmetadata', handleAudioMetadataLoaded);
        audioPlayer.addEventListener('timeupdate', updateProgressBarOnTimeUpdate);
        audioPlayer.addEventListener('play', () => { isPlaying = true; updatePlayPauseButtonVisualState(); });
        audioPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayPauseButtonVisualState(); });
        audioPlayer.addEventListener('ended', () => { /* ... ended logic (uses playNextTrackLogic) ... */ console.log("PLAYER: Ended. Repeat:"+repeatMode); isPlaying = false; updatePlayPauseButtonVisualState(); if(repeatMode===1)loadTrack(displayedPlaylist,currentTrackIndex,true); else if(repeatMode===2 || isShuffleActive || currentTrackIndex<displayedPlaylist.length-1) playNextTrackLogic(); else console.log("PLAYER: End of playlist."); });
        audioPlayer.addEventListener('error', (e) => { /* ... error logging ... */ });
    } else console.error("Listener skip: audioPlayer - CORE FAIL");

    // Upload Listeners
    if (uploadTrigger) uploadTrigger.addEventListener('click', openUploadModal); else console.error("Listener skip: uploadTrigger");
    if (closeUploadModalBtn) closeUploadModalBtn.addEventListener('click', closeUploadModal); else console.error("Listener skip: closeUploadModalBtn");
    if (fileUploadInput) fileUploadInput.addEventListener('change', (event) => handleFileUpload(event.target.files)); else console.error("Listener skip: fileUploadInput");
    if (dropZone) { /* ... dropzone listeners ... */ } else console.error("Listener skip: dropZone");

    // Search Listeners
    if (jamendoSearchButton && jamendoSearchInput) {
        jamendoSearchButton.addEventListener('click', () => searchJamendo(jamendoSearchInput.value));
        jamendoSearchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchJamendo(jamendoSearchInput.value); });
    } else console.error("Listener skip: Jamendo search elements");

    // Sidebar Navigation Listeners (Add these)
    // IMPORTANT: Add id="homeNavItem" and id="likedSongsNavItem" to the corresponding <li> elements in your index.html sidebar
    const homeNavItemElem = document.getElementById('homeNavItem');
    if(homeNavItemElem) {
        homeNavItemElem.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent default if it's a link
             document.querySelectorAll('.main-nav li').forEach(li => li.classList.remove('active')); // Update nav highlight
             homeNavItemElem.classList.add('active');
             switchToView('internal'); // Switch to internal playlist view
        });
    } else console.warn("Sidebar item 'homeNavItem' not found for listener.");

    const likedSongsNavItemElem = document.getElementById('likedSongsNavItem');
     if(likedSongsNavItemElem) {
        likedSongsNavItemElem.addEventListener('click', (e) => {
             e.preventDefault(); // Prevent default if it's a link
             document.querySelectorAll('.main-nav li').forEach(li => li.classList.remove('active')); // Update nav highlight
             likedSongsNavItemElem.classList.add('active');
            switchToView('liked'); // Switch to liked songs view
        });
     } else console.warn("Sidebar item 'likedSongsNavItem' not found for listener.");


    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => { /* ... (same) ... */ });


    // --- Initial Setup ---
    console.log("PLAYER: Initializing player...");
    if (volumeSlider && audioPlayer) audioPlayer.volume = parseFloat(volumeSlider.value); else if (audioPlayer) audioPlayer.volume = 0.8;
    updatePlayPauseButtonVisualState();
    fetchInitialPlaylist(); // Fetch local/initial songs

    console.log("main.js execution finished.");
}); // End of DOMContentLoaded