// --- STATE & DEĞİŞKENLER ---
let db;
let songs = [];
let playlists = [];
let queue = [];
let currentSongIndex = -1;
let currentSongsList = [];
let currentView = 'all';
let isPlaying = false;
let repeatMode = 0; 
let shuffleMode = false;
let swapSourceId = null;

let currentSort = 'manual';
let editMode = false;

let sleepTimerInterval = null;
let sleepEndTime = null;

let recentlyPlayed = [];

// Playlist kapakları için
let pendingPlaylistCover = null;
let currentPlaylistIdForCover = null;

// Mevcut çalan şarkının blob URL’ini tutar (bellek sızıntısını önlemek için)
let currentBlobUrl = null;

const audio = new Audio();

const el = {
    app: document.body,
    overlay: document.getElementById('overlay'),
    sidebar: document.getElementById('sidebar'),
    songList: document.getElementById('song-list'),
    viewTitle: document.getElementById('view-title'),
    storageSize: document.getElementById('storage-size'),
    playlistsContainer: document.getElementById('playlists-container'),
    
    playBtn: document.getElementById('btn-play'),
    prevBtn: document.getElementById('btn-prev'),
    nextBtn: document.getElementById('btn-next'),
    shuffleBtn: document.getElementById('btn-shuffle'),
    repeatBtn: document.getElementById('btn-repeat'),
    playerTitle: document.getElementById('player-title'),
    playerArtist: document.getElementById('player-artist'),
    playerCover: document.getElementById('player-cover'),
    
    searchInput: document.getElementById('search-input'),
    fileUpload: document.getElementById('file-upload'),
    folderUpload: document.getElementById('folder-upload'),
    coverUpload: document.getElementById('cover-upload'),
    btnEditMode: document.getElementById('btn-edit-mode'),
    listControlsBar: document.getElementById('list-controls-bar'),
    backupPanel: document.getElementById('backup-panel')
};

// Progress range elementi
const progressRange = document.getElementById('progress-range');
const timeCurrentSpan = document.getElementById('time-current');
const timeTotalSpan = document.getElementById('time-total');

// Resim Sıkıştırma (LocalStorage kotası dolmasın diye)
function resizeImage(dataUrl, maxSize = 600) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round((height *= maxSize / width));
                    width = maxSize;
                } else {
                    width = Math.round((width *= maxSize / height));
                    height = maxSize;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = dataUrl;
    });
}

function vibrate(ms = 10) {
    if (navigator.vibrate) navigator.vibrate(ms);
}

function saveRecentlyPlayed() {
    localStorage.setItem('fk_recently_played', JSON.stringify(recentlyPlayed));
}

function loadRecentlyPlayed() {
    const saved = localStorage.getItem('fk_recently_played');
    if (saved) {
        try {
            recentlyPlayed = JSON.parse(saved);
            if (!Array.isArray(recentlyPlayed)) recentlyPlayed = [];
            recentlyPlayed = recentlyPlayed.filter(id => songs.some(s => s.id === id));
        } catch(e) { recentlyPlayed = []; }
    } else {
        recentlyPlayed = [];
    }
}

function addToRecentlyPlayed(songId) {
    const index = recentlyPlayed.indexOf(songId);
    if (index !== -1) recentlyPlayed.splice(index, 1);
    recentlyPlayed.unshift(songId);
    if (recentlyPlayed.length > 10) recentlyPlayed.pop();
    saveRecentlyPlayed();
}

function showStats() {
    const totalSongs = songs.length;
    let totalSeconds = 0;
    for (const song of songs) {
        if (song.duration && typeof song.duration === 'number') totalSeconds += song.duration;
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const totalDurationStr = `${hours} saat ${minutes} dakika`;
    const artistCount = new Map();
    for (const song of songs) {
        const artist = song.artist || "Bilinmeyen Sanatçı";
        artistCount.set(artist, (artistCount.get(artist) || 0) + 1);
    }
    let topArtist = "Veri yok";
    let topCount = 0;
    for (const [artist, count] of artistCount.entries()) {
        if (count > topCount) { topCount = count; topArtist = artist; }
    }
    const statsHtml = `
        <p><strong>🎵 Toplam şarkı:</strong> ${totalSongs}</p>
        <p><strong>⏱️ Toplam çalma süresi:</strong> ${totalDurationStr}</p>
        <p><strong>🏆 En çok dinlenen sanatçı:</strong> ${topArtist} (${topCount} şarkı)</p>
    `;
    document.getElementById('stats-content').innerHTML = statsHtml;
    openModal('modal-stats');
}

// Playlist banner güncelleme
function updatePlaylistBanner(playlistId) {
    const playlist = playlists.find(p => p.id === playlistId);
    const bannerDiv = document.getElementById('list-banner');
    const bannerImg = document.getElementById('banner-img');
    if (!playlist || !currentView.startsWith('playlist_')) {
        bannerDiv.style.display = 'none';
        return;
    }
    bannerDiv.style.display = 'flex';
    const savedCover = localStorage.getItem('fk_playlist_cover_' + playlistId);
    if (savedCover) {
        bannerImg.src = savedCover;
        bannerImg.style.display = 'block';
    } else {
        bannerImg.src = '';
        bannerImg.style.display = 'none';
    }
}

function updatePlaylistCover(playlistId, dataUrl) {
    if (dataUrl) {
        try {
            localStorage.setItem('fk_playlist_cover_' + playlistId, dataUrl);
            showToast("Kapak resmi güncellendi");
        } catch(e) {
            showToast("Resim çok büyük, kaydedilemedi!");
            return;
        }
    } else {
        localStorage.removeItem('fk_playlist_cover_' + playlistId);
        showToast("Kapak resmi kaldırıldı");
    }
    
    if (currentView === `playlist_${playlistId}`) {
        updatePlaylistBanner(playlistId);
    }
}

function selectCoverForPlaylist(playlistId) {
    currentPlaylistIdForCover = playlistId;
    document.getElementById('playlist-cover-input').click();
}

document.getElementById('playlist-cover-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const resizedDataUrl = await resizeImage(ev.target.result);
            if (currentPlaylistIdForCover) {
                updatePlaylistCover(currentPlaylistIdForCover, resizedDataUrl);
                currentPlaylistIdForCover = null;
            } else {
                pendingPlaylistCover = resizedDataUrl;
                const preview = document.getElementById('playlist-cover-preview');
                preview.style.backgroundImage = `url(${pendingPlaylistCover})`;
                preview.style.backgroundSize = 'contain';
                preview.style.backgroundRepeat = 'no-repeat';
                preview.style.backgroundPosition = 'center';
            }
        };
        reader.readAsDataURL(file);
    }
    e.target.value = '';
});

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initAccentColor();
    await initDB();
    await loadData();
    loadRecentlyPlayed();
    setupEventListeners();
    setupAudioListeners();
    
    const savedSort = localStorage.getItem('fk_sort');
    if (savedSort && ['asc', 'desc', 'newest', 'manual'].includes(savedSort)) {
        currentSort = savedSort;
        if (currentSort !== 'manual') {
            editMode = false;
            el.btnEditMode.classList.remove('active');
            swapSourceId = null;
        }
        switchView(currentView);
    }
});

function showToast(msg) {
    const container = document.getElementById('toast-container');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('FKMusicDB', 2);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if(!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'songId' });
            if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
        request.onerror = (e) => { console.error("DB Hatası", e); reject(); };
    });
}

function getStore(storeName, mode = 'readonly') {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
}

function getAllFromStore(storeName) {
    return new Promise((resolve) => {
        const req = getStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
    });
}

function putToStore(storeName, data) {
    return new Promise((resolve) => {
        const req = getStore(storeName, 'readwrite').put(data);
        req.onsuccess = () => resolve();
    });
}

function deleteFromStore(storeName, id) {
    return new Promise((resolve) => {
        const req = getStore(storeName, 'readwrite').delete(id);
        req.onsuccess = () => resolve();
    });
}

function clearStore(storeName) {
    return new Promise((resolve) => {
        const req = getStore(storeName, 'readwrite').clear();
        req.onsuccess = () => resolve();
    });
}

async function loadData() {
    songs = await getAllFromStore('songs');
    playlists = await getAllFromStore('playlists');
    renderPlaylistsSidebar();
    switchView('all');
    calculateStorage();
}

function calculateStorage() {
    let totalBytes = songs.reduce((acc, song) => acc + (song.blob ? song.blob.size : 0), 0);
    el.storageSize.innerText = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function handleFiles(files) {
    vibrate(10);
    if(!files || files.length === 0) return;
    let addedCount = 0;
    for(let file of files) {
        if(!file.type.startsWith('audio/')) continue;
        let cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/official audio|official video|lyrics|hq|hd/ig, '').trim();
        let artist = "Bilinmeyen Sanatçı", title = cleanName;
        if(cleanName.includes('-')) {
            const parts = cleanName.split('-');
            artist = parts[0].trim(); title = parts.slice(1).join('-').trim();
        }
        let duration = 0;
        const url = URL.createObjectURL(file);
        const tempAudio = new Audio();
        await new Promise((resolve) => {
            tempAudio.addEventListener('loadedmetadata', () => {
                duration = tempAudio.duration;
                URL.revokeObjectURL(url);
                resolve();
            });
            tempAudio.addEventListener('error', () => {
                URL.revokeObjectURL(url);
                resolve();
            });
            tempAudio.src = url;
        });
        const song = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            title, artist, blob: file, addedAt: Date.now(), isFavorite: false, duration: duration
        };
        await putToStore('songs', song);
        songs.push(song);
        addedCount++;
    }
    if(addedCount > 0) {
        if(currentView === 'all') switchView('all');
        calculateStorage();
        showToast(`${addedCount} şarkı eklendi.`);
    }
}

function getSortedList(list) {
    let sorted = [...list];
    if(currentSort === 'asc') {
        sorted.sort((a,b) => a.title.localeCompare(b.title));
    } else if(currentSort === 'desc') {
        sorted.sort((a,b) => b.title.localeCompare(a.title));
    } else if(currentSort === 'newest') {
        sorted.sort((a,b) => b.addedAt - a.addedAt);
    } else {
        if(currentView === 'queue') {
            sorted.sort((a,b) => queue.indexOf(a.id) - queue.indexOf(b.id));
        } else if (currentView === 'recent') {
            sorted.sort((a,b) => {
                const idxA = recentlyPlayed.indexOf(a.id);
                const idxB = recentlyPlayed.indexOf(b.id);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        } else {
            sorted.sort((a,b) => b.addedAt - a.addedAt);
        }
    }
    return sorted;
}

function renderSongList(listToRender) {
    currentSongsList = getSortedList(listToRender);
    el.songList.innerHTML = '';
    if(currentSongsList.length === 0) {
        el.songList.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-sec); font-size:16px;">Burada henüz şarkı yok.</div>`;
        return;
    }
    currentSongsList.forEach((song, index) => {
        const div = document.createElement('div');
        div.className = `song-item ${audio.dataset.currentId === song.id ? 'playing' : ''}`;
        let actionsHtml = `
            <button class="action-btn" onclick="toggleFavorite('${song.id}', event)" title="Favori"><i class="${song.isFavorite ? 'fa-solid text-accent' : 'fa-regular'} fa-heart" style="${song.isFavorite?'color:var(--accent)':''}"></i></button>
            <button class="action-btn" onclick="addToQueue('${song.id}', event)" title="Sıraya Ekle"><i class="fa-solid fa-plus"></i></button>
            <button class="action-btn" onclick="openAddToPlaylistModal('${song.id}', event)" title="Çalma Listesine Ekle"><i class="fa-solid fa-list-ul"></i></button>
            <button class="action-btn" onclick="editSong('${song.id}', event)" title="Düzenle"><i class="fa-solid fa-pencil"></i></button>
            <button class="action-btn" onclick="shareSong('${song.id}', event)" title="Paylaş"><i class="fa-solid fa-share-from-square"></i></button>
        `;
        if(editMode && currentSort === 'manual') {
            actionsHtml += `<button class="action-btn ${swapSourceId === song.id ? 'swap-mode' : ''}" onclick="handleSwap('${song.id}', event)" title="Yer Değiştir"><i class="fa-solid fa-sort"></i></button>`;
        }
        actionsHtml += `<button class="action-btn" onclick="requestDelete('${song.id}', event)" title="Kaldır/Sil"><i class="fa-solid fa-trash"></i></button>`;
        div.innerHTML = `
            <div class="song-index" style="cursor:pointer;" onclick="playSong('${song.id}')">${index + 1}</div>
            <div class="song-cover"><i class="fa-solid fa-music"></i></div>
            <div class="song-title" style="cursor:pointer;" onclick="playSong('${song.id}')">${escapeHtml(song.title)}</div>
            <div class="song-artist">${escapeHtml(song.artist)}</div>
            <div class="song-actions">${actionsHtml}</div>
        `;
        loadCoverForElement(song.id, div.querySelector('.song-cover'));
        el.songList.appendChild(div);
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function renderPlaylistsSidebar() {
    el.playlistsContainer.innerHTML = '';
    playlists.forEach(p => {
        const container = document.createElement('div');
        container.className = 'playlist-item';
        
        // Çalma listesi kapağı (thumbnail)
        const coverDiv = document.createElement('div');
        coverDiv.className = 'playlist-cover-thumb';
        const savedCover = localStorage.getItem('fk_playlist_cover_' + p.id);
        if (savedCover) {
            coverDiv.innerHTML = `<img src="${savedCover}" alt="kapak">`;
        } else {
            coverDiv.innerHTML = '<i class="fa-solid fa-list"></i>';
        }
        
        const nameBtn = document.createElement('button');
        nameBtn.className = 'playlist-name';
        nameBtn.innerHTML = `${escapeHtml(p.name)}`;
        nameBtn.title = escapeHtml(p.name);
        nameBtn.onclick = () => switchView(`playlist_${p.id}`);
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'playlist-actions';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn';
        editBtn.innerHTML = '<i class="fa-solid fa-pencil"></i>';
        editBtn.title = 'Ad Değiştir';
        editBtn.onclick = (e) => { e.stopPropagation(); editPlaylist(p.id); };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.title = 'Sil';
        deleteBtn.onclick = (e) => { e.stopPropagation(); deletePlaylist(p.id); };
        
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
        
        container.appendChild(coverDiv);
        container.appendChild(nameBtn);
        container.appendChild(actionsDiv);
        el.playlistsContainer.appendChild(container);
    });
}

async function editSong(id, e) {
    if(e) e.stopPropagation();
    vibrate(10);
    const song = songs.find(s => s.id === id);
    if(!song) return;
    const newTitle = prompt("Şarkı adını girin:", song.title);
    if(newTitle !== null && newTitle.trim() !== "") song.title = newTitle.trim();
    else if(newTitle === "") { showToast("Şarkı adı boş olamaz."); return; }
    const newArtist = prompt("Sanatçı adını girin:", song.artist);
    if(newArtist !== null && newArtist.trim() !== "") song.artist = newArtist.trim();
    await putToStore('songs', song);
    renderSongList(currentSongsList);
    if(audio.dataset.currentId === id) {
        el.playerTitle.innerText = song.title;
        el.playerArtist.innerText = song.artist;
    }
    showToast("Şarkı bilgileri güncellendi.");
}

async function editPlaylist(playlistId) {
    vibrate(10);
    const playlist = playlists.find(p => p.id === playlistId);
    if(!playlist) return;
    const newName = prompt("Çalma listesi adını girin:", playlist.name);
    if(newName && newName.trim() !== "") {
        playlist.name = newName.trim();
        await putToStore('playlists', playlist);
        renderPlaylistsSidebar();
        if(currentView === `playlist_${playlistId}`) el.viewTitle.innerText = playlist.name;
        showToast("Çalma listesi adı güncellendi.");
    }
}

async function deletePlaylist(playlistId) {
    vibrate(10);
    const playlist = playlists.find(p => p.id === playlistId);
    if(!playlist) return;
    const confirmDelete = confirm(`"${playlist.name}" çalma listesini silmek istediğinize emin misiniz? (Şarkılar silinmez)`);
    if(confirmDelete) {
        await deleteFromStore('playlists', playlistId);
        playlists = playlists.filter(p => p.id !== playlistId);
        localStorage.removeItem('fk_playlist_cover_' + playlistId);
        renderPlaylistsSidebar();
        if(currentView === `playlist_${playlistId}`) switchView('all');
        showToast("Çalma listesi silindi.");
    }
}

function showArtistListModal() {
    vibrate(10);
    const artistSet = new Set();
    songs.forEach(song => { if (song.artist) artistSet.add(song.artist); });
    const uniqueArtists = Array.from(artistSet).sort((a, b) => a.localeCompare(b));
    const container = document.getElementById('artist-list-container');
    container.innerHTML = '';
    if (uniqueArtists.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-sec); font-size:16px;">Henüz hiç sanatçı yok.</div>';
    } else {
        uniqueArtists.forEach(artist => {
            const btn = document.createElement('button');
            btn.innerText = artist;
            btn.className = "artist-list-item";
            btn.onclick = () => createPlaylistForArtist(artist);
            container.appendChild(btn);
        });
    }
    openModal('modal-artist-list');
}

async function createPlaylistForArtist(artistName) {
    vibrate(10);
    const artistSongs = songs.filter(song => song.artist === artistName);
    if (artistSongs.length === 0) {
        showToast(`${artistName} adında şarkı bulunamadı.`);
        closeModal('modal-artist-list');
        return;
    }
    const songIds = artistSongs.map(song => song.id);
    const playlistName = `🎤 ${artistName}`;
    const existingPlaylist = playlists.find(p => p.name === playlistName);
    if (existingPlaylist) {
        await deleteFromStore('playlists', existingPlaylist.id);
        playlists = playlists.filter(p => p.id !== existingPlaylist.id);
    }
    const newPlaylist = { id: Date.now().toString(), name: playlistName, songIds: songIds };
    await putToStore('playlists', newPlaylist);
    playlists.push(newPlaylist);
    renderPlaylistsSidebar();
    showToast(`${artistName} eklendi.`);
    closeModal('modal-artist-list');
}

async function deleteAllSongs() {
    vibrate(10);
    const confirmDelete = confirm("Tüm şarkılar ve playlist'lerdeki bu şarkılar silinecek. Emin misiniz?");
    if (!confirmDelete) return;
    await clearStore('songs');
    await clearStore('covers');
    for (let p of playlists) { p.songIds = []; await putToStore('playlists', p); }
    await clearStore('history');
    queue = [];
    songs = [];
    recentlyPlayed = [];
    saveRecentlyPlayed();
    if (audio.src) {
        audio.pause();
        isPlaying = false;
        audio.src = '';
        audio.dataset.currentId = '';
        el.playerTitle.innerText = "Şarkı Seçilmedi";
        el.playerArtist.innerText = "-";
        el.playerCover.innerHTML = '<i class="fa-solid fa-music"></i>';
        updatePlayPauseUI();
    }
    // Mevcut blob URL varsa temizle
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }
    renderPlaylistsSidebar();
    switchView('all');
    calculateStorage();
    showToast("Tüm şarkılar silindi.");
}

async function deleteAllPlaylists() {
    vibrate(10);
    const confirmDelete = confirm("Tüm playlist'ler silinecek. Emin misiniz?");
    if (!confirmDelete) return;
    
    playlists.forEach(p => localStorage.removeItem('fk_playlist_cover_' + p.id));
    await clearStore('playlists');
    playlists = [];
    renderPlaylistsSidebar();
    if (currentView.startsWith('playlist_')) switchView('all');
    else switchView(currentView);
    showToast("Tüm playlist'ler silindi.");
}

async function clearAllFavorites() {
    vibrate(10);
    const confirmClear = confirm("Favoriler temizlenecek. Emin misiniz?");
    if (!confirmClear) return;
    for (let song of songs) { song.isFavorite = false; await putToStore('songs', song); }
    if (currentView === 'favorites') switchView('favorites');
    else renderSongList(currentSongsList);
    showToast("Favoriler temizlendi.");
}

function shareSong(songId, e) {
    if(e) e.stopPropagation();
    vibrate(10);
    const song = songs.find(s => s.id === songId);
    if(!song) return;
    const defaultText = `🎵 FK Müzik'te dinliyorum: ${song.title} - ${song.artist}`;
    const textarea = document.getElementById('share-text');
    textarea.value = defaultText;
    const copyBtn = document.getElementById('btn-copy-share');
    const newCopyBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
    newCopyBtn.onclick = () => {
        const textToCopy = document.getElementById('share-text').value;
        navigator.clipboard.writeText(textToCopy).then(() => {
            showToast("Kopyalandı!");
            closeModal('modal-share');
        }).catch(() => showToast("Kopyalama başarısız oldu."));
    };
    openModal('modal-share');
}

function initAccentColor() {
    const savedColor = localStorage.getItem('fk_accent_color');
    const defaultColor = '#1DB954';
    const color = savedColor || defaultColor;
    document.documentElement.style.setProperty('--accent', color);
    document.querySelectorAll('.color-option').forEach(btn => {
        const btnColor = btn.getAttribute('data-color');
        if (btnColor === color) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

function setAccentColor(color) {
    document.documentElement.style.setProperty('--accent', color);
    localStorage.setItem('fk_accent_color', color);
    document.querySelectorAll('.color-option').forEach(btn => {
        if (btn.getAttribute('data-color') === color) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

// DÜZELTİLMİŞ playSong FONKSİYONU
async function playSong(id) {
    vibrate(10);
    const song = songs.find(s => s.id === id);
    if (!song) { showToast("Şarkı bulunamadı!"); return; }

    // 1. Önceki blob URL’i iptal et (bellek sızıntısını önle)
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }

    // 2. Yeni, taze bir blob URL oluştur
    if (song.blob) {
        const freshUrl = URL.createObjectURL(song.blob);
        audio.src = freshUrl;
        currentBlobUrl = freshUrl;   // yeni URL’i sakla
        audio.dataset.currentId = song.id;
    } else {
        showToast("Ses dosyası bulunamadı!");
        return;
    }

    // 3. Geri kalan işlemler aynen devam et
    currentSongIndex = currentSongsList.findIndex(s => s.id === id);
    el.playerTitle.innerText = song.title;
    el.playerArtist.innerText = song.artist;

    const req = getStore('covers').get(song.id);
    req.onsuccess = () => {
        if (req.result) el.playerCover.innerHTML = `<img src="${req.result.dataURL}">`;
        else el.playerCover.innerHTML = `<i class="fa-solid fa-music"></i>`;
    };

    audio.play().catch(err => console.error(err));
    isPlaying = true;
    addToRecentlyPlayed(song.id);
    updatePlayPauseUI();
    renderSongList(currentSongsList);
    updateMediaSession(song);
}

function togglePlay() {
    vibrate(10);
    if(!audio.src) { if(currentSongsList.length > 0) playSong(currentSongsList[0].id); return; }
    if(isPlaying) { audio.pause(); isPlaying = false; }
    else { audio.play(); isPlaying = true; }
    updatePlayPauseUI();
}

function playNext() {
    vibrate(10);
    if(queue.length > 0) { const nextId = queue.shift(); playSong(nextId); if(currentView === 'queue') switchView('queue'); return; }
    if(currentSongsList.length === 0) return;
    if(shuffleMode) { const randomIndex = Math.floor(Math.random() * currentSongsList.length); playSong(currentSongsList[randomIndex].id); return; }
    let nextIndex = currentSongIndex + 1;
    if(nextIndex >= currentSongsList.length) { if(repeatMode === 1) nextIndex = 0; else return; }
    playSong(currentSongsList[nextIndex].id);
}

function playPrev() {
    vibrate(10);
    if(audio.currentTime > 3) { audio.currentTime = 0; return; }
    if(currentSongsList.length === 0) return;
    let prevIndex = currentSongIndex - 1;
    if(prevIndex < 0) prevIndex = currentSongsList.length - 1;
    playSong(currentSongsList[prevIndex].id);
}

function updatePlayPauseUI() {
    el.playBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

function setupAudioListeners() {
    audio.addEventListener('timeupdate', () => {
        if(!audio.duration) return;
        const percent = (audio.currentTime / audio.duration) * 100;
        progressRange.value = percent;
        timeCurrentSpan.innerText = formatTime(audio.currentTime);
        timeTotalSpan.innerText = formatTime(audio.duration);
        if(audio.currentTime >= 10 && !audio.dataset.historySaved) {
            audio.dataset.historySaved = "true";
            saveToHistory(audio.dataset.currentId);
        }
    });
    audio.addEventListener('ended', () => {
        if(repeatMode === 2) { audio.currentTime = 0; audio.play(); }
        else playNext();
    });
    audio.addEventListener('loadstart', () => audio.dataset.historySaved = "");
    
    progressRange.addEventListener('input', (e) => {
        if (audio.duration) {
            const newTime = (e.target.value / 100) * audio.duration;
            audio.currentTime = newTime;
            timeCurrentSpan.innerText = formatTime(newTime);
        }
    });
}

function formatTime(seconds) {
    if(isNaN(seconds)) return "0:00";
    const min = Math.floor(seconds / 60), sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
}

function updateMediaSession(song) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, album: 'FK Müzik' });
        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('previoustrack', playPrev);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }
}

function addToQueue(id, e) {
    e.stopPropagation();
    vibrate(10);
    queue.push(id);
    showToast("Sıraya eklendi");
    if(currentView === 'queue') switchView('queue');
}

function switchView(view) {
    currentView = view;
    swapSourceId = null;
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
    const sidebarItem = document.querySelector(`.menu-item[data-view="${view}"]`);
    if(sidebarItem) sidebarItem.classList.add('active');
    
    // Standart liste kontrolleri ve şarkı listesi görünürlüğü
    const mainElements = {
        listControlsBar: el.listControlsBar,
        listHeader: document.querySelector('.list-header'),
        songList: el.songList,
        backupPanel: el.backupPanel
    };

    // Varsayılan: liste görünümleri
    let showListControls = true;
    let showListHeader = true;
    let showSongList = true;
    let showBackupPanel = false;

    if (['history', 'queue', 'recent'].includes(view)) {
        showListControls = false;
    }

    if (view === 'backup') {
        showListControls = false;
        showListHeader = false;
        showSongList = false;
        showBackupPanel = true;
    }

    el.listControlsBar.style.display = showListControls ? 'flex' : 'none';
    if (mainElements.listHeader) mainElements.listHeader.style.display = showListHeader ? '' : 'none';
    el.songList.style.display = showSongList ? '' : 'none';
    if (el.backupPanel) el.backupPanel.style.display = showBackupPanel ? 'block' : 'none';

    if(view === 'all') { 
        el.viewTitle.innerText = "Tüm Şarkılar"; 
        renderSongList(songs);
        document.getElementById('list-banner').style.display = 'none';
    }
    else if(view === 'favorites') { 
        el.viewTitle.innerText = "Favoriler"; 
        renderSongList(songs.filter(s => s.isFavorite));
        document.getElementById('list-banner').style.display = 'none';
    }
    else if(view === 'history') { 
        el.viewTitle.innerText = "Geçmiş"; 
        loadHistory();
        document.getElementById('list-banner').style.display = 'none';
    }
    else if(view === 'queue') {
        el.viewTitle.innerText = "Sıram";
        renderSongList(queue.map(id => songs.find(s => s.id === id)).filter(Boolean));
        document.getElementById('list-banner').style.display = 'none';
    }
    else if(view === 'recent') {
        el.viewTitle.innerText = "Son Çalınanlar";
        const recentSongs = recentlyPlayed.map(id => songs.find(s => s.id === id)).filter(Boolean);
        renderSongList(recentSongs);
        document.getElementById('list-banner').style.display = 'none';
    }
    else if(view.startsWith('playlist_')) {
        const playlistId = view.split('_')[1];
        const p = playlists.find(p => p.id === playlistId);
        if(p) {
            el.viewTitle.innerText = p.name;
            renderSongList(p.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean));
            updatePlaylistBanner(playlistId);
            const updateBtn = document.getElementById('btn-update-cover');
            if (updateBtn) {
                updateBtn.onclick = () => selectCoverForPlaylist(playlistId);
            }
        }
    }
    else if(view === 'backup') {
        el.viewTitle.innerText = "Yedekleme";
        document.getElementById('list-banner').style.display = 'none';
    }
    closeSidebar();
}

async function loadHistory() {
    const hist = await getAllFromStore('history');
    hist.sort((a, b) => b.timestamp - a.timestamp);
    renderSongList(hist.map(h => songs.find(s => s.id === h.id)).filter(Boolean));
}

async function saveToHistory(id) {
    await putToStore('history', { id, timestamp: Date.now() });
}

async function toggleFavorite(id, e) {
    e.stopPropagation();
    vibrate(10);
    const song = songs.find(s => s.id === id);
    song.isFavorite = !song.isFavorite;
    await putToStore('songs', song);
    renderSongList(currentSongsList);
}

async function handleSwap(id, e) {
    e.stopPropagation();
    vibrate(10);
    if(!swapSourceId) { 
        swapSourceId = id; 
        renderSongList(currentSongsList); 
    } else {
        if(swapSourceId !== id) {
            if(currentView === 'queue') {
                const idx1 = queue.indexOf(swapSourceId);
                const idx2 = queue.indexOf(id);
                if(idx1 !== -1 && idx2 !== -1) {
                    const temp = queue[idx1];
                    queue[idx1] = queue[idx2];
                    queue[idx2] = temp;
                }
            } else {
                const idx1 = songs.findIndex(s => s.id === swapSourceId);
                const idx2 = songs.findIndex(s => s.id === id);
                const temp = songs[idx1].addedAt;
                songs[idx1].addedAt = songs[idx2].addedAt;
                songs[idx2].addedAt = temp;
                await putToStore('songs', songs[idx1]);
                await putToStore('songs', songs[idx2]);
            }
        }
        swapSourceId = null; 
        switchView(currentView);
    }
}

document.getElementById('btn-create-playlist').onclick = () => {
    document.getElementById('playlist-name-input').value = '';
    pendingPlaylistCover = null;
    const preview = document.getElementById('playlist-cover-preview');
    preview.style.backgroundImage = '';
    preview.style.backgroundColor = '';
    preview.style.background = 'linear-gradient(135deg, #1DB954, #191414)';
    openModal('modal-create-playlist');
};
document.getElementById('btn-select-playlist-cover').onclick = () => {
    document.getElementById('playlist-cover-input').click();
};

document.getElementById('btn-confirm-create-playlist').onclick = async () => {
    vibrate(10);
    const name = document.getElementById('playlist-name-input').value.trim();
    if(!name) return;
    const p = { id: Date.now().toString(), name, songIds: [] };
    
    if (pendingPlaylistCover) {
        try {
            localStorage.setItem('fk_playlist_cover_' + p.id, pendingPlaylistCover);
        } catch(e) {
            showToast("Resim çok büyük, kaydedilemedi!");
        }
    }
    
    await putToStore('playlists', p);
    playlists.push(p);
    renderPlaylistsSidebar();
    closeModal('modal-create-playlist');
    pendingPlaylistCover = null;
};

let songToAddId = null;
function openAddToPlaylistModal(id, e) {
    e.stopPropagation();
    vibrate(10);
    songToAddId = id;
    const listEl = document.getElementById('modal-playlist-list');
    listEl.innerHTML = '';
    playlists.forEach(p => {
        const btn = document.createElement('button'); btn.innerText = p.name;
        btn.className = "playlist-add-btn";
        btn.onclick = async () => {
            vibrate(10);
            if(!p.songIds.includes(songToAddId)) { p.songIds.push(songToAddId); await putToStore('playlists', p); showToast("Listeye eklendi."); }
            closeModal('modal-add-to-playlist');
        };
        listEl.appendChild(btn);
    });
    openModal('modal-add-to-playlist');
}

let songToDeleteId = null;
function requestDelete(id, e) {
    e.stopPropagation();
    vibrate(10);
    songToDeleteId = id;
    let text = "Bu şarkıyı tamamen silmek istediğinize emin misiniz?";
    if(currentView === 'favorites') text = "Bu şarkıyı favorilerden çıkarmak istiyor musunuz?";
    else if(currentView === 'queue') text = "Bu şarkıyı sıradan çıkarmak istiyor musunuz?";
    else if(currentView === 'history') text = "Bu şarkıyı geçmişten kaldırmak istiyor musunuz?";
    else if(currentView.startsWith('playlist_')) text = "Bu şarkıyı çalma listesinden çıkarmak istiyor musunuz?";
    document.getElementById('delete-warning-text').innerText = text;
    openModal('modal-confirm-delete');
}

document.getElementById('btn-confirm-delete').onclick = async () => {
    vibrate(10);
    if(!songToDeleteId) return;
    if(currentView === 'all') {
        await deleteFromStore('songs', songToDeleteId);
        songs = songs.filter(s => s.id !== songToDeleteId);
        await deleteFromStore('covers', songToDeleteId);
        const idx = recentlyPlayed.indexOf(songToDeleteId);
        if (idx !== -1) recentlyPlayed.splice(idx, 1);
        saveRecentlyPlayed();
    } else if(currentView === 'favorites') {
        const song = songs.find(s => s.id === songToDeleteId);
        song.isFavorite = false; await putToStore('songs', song);
    } else if(currentView === 'queue') {
        const idx = queue.indexOf(songToDeleteId);
        if(idx !== -1) queue.splice(idx, 1);
    } else if(currentView === 'history') {
        await deleteFromStore('history', songToDeleteId);
    } else if(currentView.startsWith('playlist_')) {
        const p = playlists.find(p => p.id === currentView.split('_')[1]);
        p.songIds = p.songIds.filter(id => id !== songToDeleteId); await putToStore('playlists', p);
    }
    closeModal('modal-confirm-delete'); 
    switchView(currentView); 
    calculateStorage();
};

el.playerCover.addEventListener('click', () => { if(audio.dataset.currentId) el.coverUpload.click(); });
el.coverUpload.addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        await putToStore('covers', { songId: audio.dataset.currentId, dataURL: ev.target.result });
        el.playerCover.innerHTML = `<img src="${ev.target.result}">`;
        renderSongList(currentSongsList);
    };
    reader.readAsDataURL(file);
});

function loadCoverForElement(songId, element) {
    const req = getStore('covers').get(songId);
    req.onsuccess = () => { if(req.result) element.innerHTML = `<img src="${req.result.dataURL}">`; };
}

function initTheme() {
    const saved = localStorage.getItem('fk_theme') || 'dark';
    document.body.setAttribute('data-theme', saved);
}

document.getElementById('btn-theme-toggle').onclick = () => {
    vibrate(10);
    const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next); localStorage.setItem('fk_theme', next);
};

// ZIP geri yükleme işlemleri
function getAudioDurationFromBlob(blob) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const tempAudio = new Audio();
        tempAudio.addEventListener('loadedmetadata', () => {
            const duration = tempAudio.duration;
            URL.revokeObjectURL(url);
            resolve(isNaN(duration) ? 0 : duration);
        });
        tempAudio.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            resolve(0);
        });
        tempAudio.src = url;
    });
}

function extractTitleArtist(filename) {
    // Uzantıyı kaldır
    let name = filename.replace(/\.[^/.]+$/, "");
    name = name.replace(/official audio|official video|lyrics|hq|hd/ig, '').trim();
    let artist = "Bilinmeyen Sanatçı";
    let title = name;
    if (name.includes('-')) {
        const parts = name.split('-');
        artist = parts[0].trim();
        title = parts.slice(1).join('-').trim();
    }
    return { artist, title };
}

const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'];

async function restoreFromZip(file) {
    vibrate(10);
    if (!file) {
        showToast("Lütfen bir ZIP dosyası seçin.");
        return;
    }

    try {
        const zip = await JSZip.loadAsync(file);
        let audioFiles = [];
        let iconFile = null;

        // ZIP içindeki dosyaları tara
        zip.forEach((relativePath, zipEntry) => {
            const ext = relativePath.split('.').pop().toLowerCase();
            if (SUPPORTED_AUDIO_EXTENSIONS.includes(ext) && !zipEntry.dir) {
                audioFiles.push(zipEntry);
            } else if ((relativePath === 'icon.png' || relativePath === 'icon.jpg') && !zipEntry.dir) {
                iconFile = zipEntry;
            } else if ((relativePath === 'playlist_cover.png' || relativePath === 'playlist_cover.jpg') && !zipEntry.dir) {
                // Playlist kapak dosyası varsa yakala (şimdilik kullanmıyoruz, ileriye dönük)
                // playlistCoverFile = zipEntry;
            }
        });

        if (audioFiles.length === 0) {
            showToast("ZIP dosyası içinde desteklenen ses dosyası bulunamadı.");
            return;
        }

        let addedCount = 0;
        const iconBase64Promise = iconFile
            ? iconFile.async('base64').then(base64 => `data:${iconFile.name.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${base64}`)
            : Promise.resolve(null);

        const iconBase64 = await iconBase64Promise;

        for (const zipEntry of audioFiles) {
            try {
                const blob = await zipEntry.async('blob');
                const { artist, title } = extractTitleArtist(zipEntry.name);
                const duration = await getAudioDurationFromBlob(blob);
                const song = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    title,
                    artist,
                    blob,
                    addedAt: Date.now(),
                    isFavorite: false,
                    duration
                };
                await putToStore('songs', song);
                songs.push(song);
                addedCount++;

                // İkon varsa kapak olarak ata
                if (iconBase64) {
                    await putToStore('covers', { songId: song.id, dataURL: iconBase64 });
                }
            } catch (err) {
                console.error(`Şarkı işlenirken hata: ${zipEntry.name}`, err);
            }
        }

        if (addedCount > 0) {
            calculateStorage();
            // Mevcut görünümü güncelle
            switchView(currentView);
            showToast(`${addedCount} şarkı başarıyla geri yüklendi.`);
        } else {
            showToast("Şarkılar geri yüklenemedi.");
        }
    } catch (err) {
        console.error("ZIP okuma hatası:", err);
        showToast("ZIP dosyası okunamadı veya geçersiz dosya.");
    }
}

function setupEventListeners() {
    document.getElementById('btn-menu').onclick = () => { el.sidebar.classList.add('open'); el.overlay.classList.add('show'); };
    document.getElementById('close-sidebar').onclick = closeSidebar;
    el.overlay.onclick = () => closeSidebar();
    
    document.getElementById('btn-upload-menu').onclick = (e) => { e.stopPropagation(); document.getElementById('upload-options').classList.toggle('show'); };
    document.onclick = (e) => { if(!e.target.closest('.upload-dropdown')) document.getElementById('upload-options').classList.remove('show'); };
    
    document.getElementById('btn-add-files').onclick = () => el.fileUpload.click();
    document.getElementById('btn-add-folder').onclick = () => el.folderUpload.click();
    el.fileUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    el.folderUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    
    document.querySelectorAll('.menu-item[data-view]').forEach(btn => {
        btn.onclick = () => { switchView(btn.dataset.view); };
    });
    
    document.getElementById('btn-artist-playlist').onclick = () => {
        showArtistListModal();
        closeSidebar();
    };
    
    document.getElementById('btn-stats').onclick = () => {
        vibrate(10);
        showStats();
        closeSidebar();
    };
    
    document.getElementById('btn-delete-all-songs').onclick = () => { deleteAllSongs(); closeSidebar(); };
    document.getElementById('btn-delete-all-playlists').onclick = () => { deleteAllPlaylists(); closeSidebar(); };
    document.getElementById('btn-clear-all-favorites').onclick = () => { clearAllFavorites(); closeSidebar(); };
    
    document.querySelectorAll('.color-option').forEach(btn => {
        btn.onclick = () => {
            vibrate(10);
            const color = btn.getAttribute('data-color');
            setAccentColor(color);
            closeSidebar();
        };
    });
    
    el.playBtn.onclick = togglePlay; el.nextBtn.onclick = playNext; el.prevBtn.onclick = playPrev;
    el.shuffleBtn.onclick = () => { vibrate(10); shuffleMode = !shuffleMode; el.shuffleBtn.classList.toggle('active', shuffleMode); };
    el.repeatBtn.onclick = () => {
        vibrate(10);
        repeatMode = (repeatMode + 1) % 3;
        if(repeatMode === 0) el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>', el.repeatBtn.classList.remove('active');
        else if(repeatMode === 1) el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>', el.repeatBtn.classList.add('active');
        else el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat-1"></i>', el.repeatBtn.classList.add('active');
    };
    
    el.searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        let list;
        if(currentView === 'all') list = songs;
        else if(currentView === 'favorites') list = songs.filter(s => s.isFavorite);
        else if(currentView === 'queue') list = queue.map(id => songs.find(s => s.id === id)).filter(Boolean);
        else if(currentView === 'recent') list = recentlyPlayed.map(id => songs.find(s => s.id === id)).filter(Boolean);
        else list = currentSongsList;
        renderSongList(!query ? list : list.filter(s => s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query)));
    });

    const btnSort = document.getElementById('btn-sort');
    const sortOptions = document.getElementById('sort-options');
    btnSort.onclick = (e) => { e.stopPropagation(); sortOptions.classList.toggle('show'); };
    document.querySelectorAll('#sort-options button').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            vibrate(10);
            const sortValue = btn.getAttribute('data-sort');
            if (sortValue) {
                currentSort = sortValue;
                localStorage.setItem('fk_sort', currentSort);
                if (currentSort !== 'manual') {
                    editMode = false;
                    el.btnEditMode.classList.remove('active');
                    swapSourceId = null;
                }
                switchView(currentView);
                showToast(`Sıralama: ${btn.innerText}`);
            }
            sortOptions.classList.remove('show');
        };
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.sort-dropdown')) sortOptions.classList.remove('show');
    });

    el.btnEditMode.onclick = () => {
        vibrate(10);
        if(currentSort !== 'manual') {
            showToast("Düzenleme modu sadece 'Benim Sıralamam' seçiliyken çalışır.");
            return;
        }
        editMode = !editMode;
        el.btnEditMode.classList.toggle('active', editMode);
        swapSourceId = null;
        renderSongList(currentSongsList);
    };

    // --- Yedekleme Paneli Olayları ---
    document.getElementById('btn-copy-link').onclick = () => {
        vibrate(10);
        const link = document.getElementById('fkzip-link').innerText;
        navigator.clipboard.writeText(link).then(() => {
            showToast("FK Zip bağlantısı kopyalandı.");
        }).catch(() => {
            showToast("Kopyalama başarısız oldu.");
        });
    };

    document.getElementById('btn-select-zip').onclick = () => {
        vibrate(10);
        document.getElementById('zip-restore-input').click();
    };

    document.getElementById('zip-restore-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            restoreFromZip(file);
        }
        // input'u sıfırla ki aynı dosya tekrar seçilebilsin
        e.target.value = '';
    });

    // Uyku Zamanlayıcı
    const mobileSleepBtn = document.getElementById('btn-sleep-timer-mobile');
    const sleepTimerDisplay = document.getElementById('sleep-timer-display');
    const btnCancelSleepTimer = document.getElementById('btn-cancel-sleep-timer');
    
    function cancelSleepTimer() {
        if (sleepTimerInterval) { clearInterval(sleepTimerInterval); sleepTimerInterval = null; }
        sleepEndTime = null;
        if (sleepTimerDisplay) sleepTimerDisplay.innerText = "";
        if (btnCancelSleepTimer) btnCancelSleepTimer.style.display = 'none';
        if (mobileSleepBtn) mobileSleepBtn.classList.remove('active');
    }
    
    function startSleepTimer(minutes) {
        cancelSleepTimer();
        if (mobileSleepBtn) mobileSleepBtn.classList.add('active');
        if (btnCancelSleepTimer) btnCancelSleepTimer.style.display = 'inline-flex';
        sleepEndTime = Date.now() + minutes * 60 * 1000;
        sleepTimerInterval = setInterval(() => {
            let remain = Math.ceil((sleepEndTime - Date.now()) / 1000);
            if (remain <= 0) {
                audio.pause();
                isPlaying = false;
                updatePlayPauseUI();
                cancelSleepTimer();
                showToast("Uyku modu süresi doldu. Müzik durduruldu.");
            } else {
                let m = Math.floor(remain / 60);
                let s = remain % 60;
                sleepTimerDisplay.innerText = `⏳ Kalan: ${m}:${s < 10 ? '0'+s : s}`;
            }
        }, 1000);
    }
    
    if (btnCancelSleepTimer) btnCancelSleepTimer.onclick = () => { vibrate(10); cancelSleepTimer(); };
    
    document.querySelectorAll('.timer-btn[data-time]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            vibrate(10);
            const time = parseInt(btn.getAttribute('data-time'));
            if (time > 0) startSleepTimer(time);
            else cancelSleepTimer();
            closeModal('modal-sleep-timer');
        };
    });
    
    const btnCustomTimer = document.getElementById('btn-custom-timer');
    if (btnCustomTimer) {
        btnCustomTimer.onclick = () => {
            vibrate(10);
            let minutes = prompt("Dakika cinsinden süre girin (1-999):", "30");
            if (minutes === null) return;
            minutes = parseInt(minutes);
            if (isNaN(minutes) || minutes <= 0) { showToast("Geçerli bir süre giriniz."); return; }
            startSleepTimer(minutes);
            closeModal('modal-sleep-timer');
        };
    }
    
    const btnCancelTimer = document.getElementById('btn-cancel-timer');
    if (btnCancelTimer) btnCancelTimer.onclick = () => { vibrate(10); cancelSleepTimer(); closeModal('modal-sleep-timer'); };
    
    if (mobileSleepBtn) mobileSleepBtn.onclick = () => openModal('modal-sleep-timer');
}

function closeSidebar() { el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); }
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }