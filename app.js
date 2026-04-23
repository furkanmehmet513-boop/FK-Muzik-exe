// ==================== DURUM & DEĞİŞKENLER ====================
let db;
let songs = [];
let playlists = [];
let queue = [];
let currentSongIndex = -1;
let currentSongsList = [];
let currentView = 'all';
let isPlaying = false;
let repeatMode = 0; // 0: Tekrar yok, 1: Tümünü tekrarla, 2: Tek şarkıyı tekrarla
let shuffleMode = false;
let swapSourceId = null;
let currentSort = 'manual';
let editMode = false;
let sleepTimerInterval = null;
let sleepEndTime = null;
let recentlyPlayed = [];
let pendingPlaylistCover = null;
let currentPlaylistIdForCover = null;

const audio = new Audio();

// ==================== HTML ELEMENT REFERANSLARI ====================
const el = {
    overlay: document.getElementById('overlay'),
    sidebar: document.getElementById('sidebar'),
    songList: document.getElementById('song-list'),
    backupPanel: document.getElementById('backup-panel'),
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
    searchBoxContainer: document.getElementById('search-box-container'),
    fileUpload: document.getElementById('file-upload'),
    folderUpload: document.getElementById('folder-upload'),
    coverUpload: document.getElementById('cover-upload'),
    btnEditMode: document.getElementById('btn-edit-mode'),
    listControlsBar: document.getElementById('list-controls-bar'),
    listHeader: document.getElementById('list-header'),
    
    progressRange: document.getElementById('progress-range'),
    timeCurrentSpan: document.getElementById('time-current'),
    timeTotalSpan: document.getElementById('time-total')
};

// ==================== UYGULAMA BAŞLATMA ====================
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initAccentColor();
    setupWindowControls(); // HTML2EXE masaüstü kontrolleri
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

// ==================== MASAÜSTÜ KONTROLLERİ (HTML2EXE UYUMLULUĞU) ====================
function setupWindowControls() {
    // Sürükleme ve standart HTML2EXE API'sini entegre etme
    document.getElementById('btn-minimize').addEventListener('click', () => {
        if (typeof window.minimize === 'function') window.minimize();
    });
    
    document.getElementById('btn-maximize').addEventListener('click', () => {
        if (typeof window.toggleMaximize === 'function') {
            window.toggleMaximize();
            setTimeout(updateMaximizeButtonIcon, 100);
        }
    });
    
    document.getElementById('btn-close').addEventListener('click', () => {
        if (typeof window.close === 'function') window.close();
        else window.close(); // Standart kapatma fallback
    });
}

function updateMaximizeButtonIcon() {
    const maxBtn = document.getElementById('btn-maximize');
    const isMax = (typeof window.isMaximized === 'function') ? window.isMaximized() : 
                  (window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight);
    maxBtn.innerHTML = isMax ? '<i class="fa-regular fa-clone"></i>' : '<i class="fa-regular fa-square"></i>';
}

// ==================== YARDIMCI FONKSİYONLAR ====================
function showToast(msg) {
    const container = document.getElementById('toast-container');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
    // Mobil titreşim geri bildirimi
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
}

// Resim Sıkıştırma (IndexedDB / LocalStorage şişmesini önler)
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function formatTime(seconds) {
    if(isNaN(seconds)) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
}

// Ses dosyası uzantılarını kontrol et
function isAudioFile(filename) {
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma'];
    const lowerName = filename.toLowerCase();
    return audioExtensions.some(ext => lowerName.endsWith(ext));
}

// Dosya adından sanatçı ve başlık çıkar
function parseFilename(filename) {
    // Uzantıyı kaldır
    let cleanName = filename.replace(/\.[^/.]+$/, "").replace(/official audio|official video|lyrics|hq|hd/ig, '').trim();
    let artist = "Bilinmeyen Sanatçı", title = cleanName;
    
    if(cleanName.includes('-')) {
        const parts = cleanName.split('-');
        artist = parts[0].trim(); 
        title = parts.slice(1).join('-').trim();
    }
    
    return { artist, title };
}

// Blob'dan ses süresi alma (Promise)
function getAudioDuration(blob) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const tempAudio = new Audio();
        tempAudio.addEventListener('loadedmetadata', () => {
            const duration = tempAudio.duration;
            URL.revokeObjectURL(url);
            resolve(duration);
        });
        tempAudio.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            resolve(0);
        });
        tempAudio.src = url;
    });
}

// ==================== VERİTABANI İŞLEMLERİ (INDEXEDDB) ====================
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

// ==================== VERİ YÜKLEME VE YÖNETİM ====================
async function loadData() {
    songs = await getAllFromStore('songs');
    playlists = await getAllFromStore('playlists');
    renderPlaylistsSidebar();
    switchView('all');
    calculateStorage();
}

function calculateStorage() {
    // Sadece blob boyutlarını hesaplar
    let totalBytes = songs.reduce((acc, song) => acc + (song.blob ? song.blob.size : 0), 0);
    el.storageSize.innerText = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
}

function loadRecentlyPlayed() {
    try {
        const saved = localStorage.getItem('fk_recently_played');
        recentlyPlayed = saved ? JSON.parse(saved) : [];
        if (!Array.isArray(recentlyPlayed)) recentlyPlayed = [];
        recentlyPlayed = recentlyPlayed.filter(id => songs.some(s => s.id === id));
    } catch(e) { recentlyPlayed = []; }
}

function saveRecentlyPlayed() {
    localStorage.setItem('fk_recently_played', JSON.stringify(recentlyPlayed));
}

function addToRecentlyPlayed(songId) {
    const index = recentlyPlayed.indexOf(songId);
    if (index !== -1) recentlyPlayed.splice(index, 1);
    recentlyPlayed.unshift(songId);
    if (recentlyPlayed.length > 20) recentlyPlayed.pop(); // Son 20 kayıt tutulur
    saveRecentlyPlayed();
}

async function handleFiles(files) {
    if(!files || files.length === 0) return;
    let addedCount = 0;
    
    for(let file of files) {
        if(!file.type.startsWith('audio/')) continue;
        
        // Şarkı adını ve sanatçıyı dosyadan ayıklama
        const { artist, title } = parseFilename(file.name);
        
        // Süreyi alma
        const duration = await getAudioDuration(file);
        
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

// ==================== ZIP GERİ YÜKLEME ====================
async function restoreFromZip(zipFile) {
    const statusEl = document.getElementById('restore-status');
    const restoreBtn = document.getElementById('btn-restore-zip');
    
    // Durum mesajını göster
    statusEl.className = 'restore-status show';
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ZIP dosyası işleniyor...';
    restoreBtn.disabled = true;
    
    try {
        // JSZip ile ZIP'i yükle
        const zip = await JSZip.loadAsync(zipFile);
        
        const audioFiles = [];
        let iconFile = null;
        let playlistCoverFile = null;
        
        // ZIP içindeki dosyaları tara
        zip.forEach((relativePath, file) => {
            if (file.dir) return; // Klasörleri atla
            
            const filename = relativePath.split('/').pop(); // Yalnızca dosya adını al
            const lowerName = filename.toLowerCase();
            
            if (isAudioFile(filename)) {
                audioFiles.push({ name: relativePath, file });
            } else if (lowerName === 'icon.png' || lowerName === 'icon.jpg' || lowerName === 'icon.jpeg') {
                iconFile = file;
            } else if (lowerName === 'playlist_cover.png' || lowerName === 'playlist_cover.jpg' || lowerName === 'playlist_cover.jpeg') {
                playlistCoverFile = file;
            }
        });
        
        if (audioFiles.length === 0) {
            throw new Error('ZIP dosyası içinde ses dosyası bulunamadı.');
        }
        
        // İkon dosyasını Base64'e çevir (varsa)
        let iconBase64 = null;
        if (iconFile) {
            const iconBlob = await iconFile.async('blob');
            iconBase64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(iconBlob);
            });
            // Resmi sıkıştır
            iconBase64 = await resizeImage(iconBase64);
        }
        
        // Playlist kapağını işle (varsa)
        if (playlistCoverFile) {
            const coverBlob = await playlistCoverFile.async('blob');
            const coverBase64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(coverBlob);
            });
            const resizedCover = await resizeImage(coverBase64);
            // Eğer bir playlist görünümündeysek veya genel amaçlı saklamak için
            // LocalStorage'da 'fk_zip_playlist_cover' anahtarında saklayalım
            try {
                localStorage.setItem('fk_zip_playlist_cover', resizedCover);
            } catch(e) { /* boyut hatası olursa sessizce geç */ }
        }
        
        // Ses dosyalarını işle ve şarkıları oluştur
        let restoredCount = 0;
        const restoredSongIds = [];
        
        for (const { name, file } of audioFiles) {
            try {
                const blob = await file.async('blob');
                const filename = name.split('/').pop();
                const { artist, title } = parseFilename(filename);
                const duration = await getAudioDuration(blob);
                
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
                restoredSongIds.push(song.id);
                restoredCount++;
            } catch (fileError) {
                console.warn(`Dosya işlenirken hata: ${name}`, fileError);
            }
        }
        
        // İkon varsa, geri yüklenen tüm şarkılara kapak olarak ata
        if (iconBase64 && restoredSongIds.length > 0) {
            for (const songId of restoredSongIds) {
                await putToStore('covers', { songId, dataURL: iconBase64 });
            }
        }
        
        // Durum mesajını güncelle
        statusEl.className = 'restore-status show success';
        statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${restoredCount} şarkı başarıyla geri yüklendi.`;
        
        // UI'ı güncelle
        calculateStorage();
        if (currentView === 'all' || currentView === 'backup') {
            switchView('all');
        }
        renderPlaylistsSidebar();
        
        showToast(`${restoredCount} şarkı başarıyla geri yüklendi.`);
        
        // Mobil titreşim geri bildirimi
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
        }
        
    } catch (error) {
        console.error('ZIP geri yükleme hatası:', error);
        statusEl.className = 'restore-status show error';
        statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Hata: ${error.message || 'ZIP dosyası işlenemedi.'}`;
        showToast('ZIP geri yükleme başarısız: ' + error.message);
    } finally {
        restoreBtn.disabled = false;
        // 5 saniye sonra durum mesajını gizle
        setTimeout(() => {
            statusEl.classList.remove('show', 'success', 'error');
        }, 5000);
    }
}

// ==================== LİSTELEME VE RENDER (MASAÜSTÜ) ====================
function getSortedList(list) {
    let sorted = [...list];
    if(currentSort === 'asc') sorted.sort((a,b) => a.title.localeCompare(b.title));
    else if(currentSort === 'desc') sorted.sort((a,b) => b.title.localeCompare(a.title));
    else if(currentSort === 'newest') sorted.sort((a,b) => b.addedAt - a.addedAt);
    else {
        if(currentView === 'queue') sorted.sort((a,b) => queue.indexOf(a.id) - queue.indexOf(b.id));
        else if (currentView === 'recent') {
            sorted.sort((a,b) => {
                const idxA = recentlyPlayed.indexOf(a.id);
                const idxB = recentlyPlayed.indexOf(b.id);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        } 
        else sorted.sort((a,b) => b.addedAt - a.addedAt);
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
            <button class="action-btn" onclick="toggleFavorite('${song.id}', event)" title="Favori"><i class="${song.isFavorite ? 'fa-solid text-accent' : 'fa-regular'} fa-heart"></i></button>
            <button class="action-btn" onclick="addToQueue('${song.id}', event)" title="Sıraya Ekle"><i class="fa-solid fa-plus"></i></button>
            <button class="action-btn" onclick="openAddToPlaylistModal('${song.id}', event)" title="Çalma Listesine Ekle"><i class="fa-solid fa-list-ul"></i></button>
            <button class="action-btn" onclick="editSong('${song.id}', event)" title="Düzenle"><i class="fa-solid fa-pencil"></i></button>
            <button class="action-btn" onclick="shareSong('${song.id}', event)" title="Paylaş"><i class="fa-solid fa-share-nodes"></i></button>
            <button class="action-btn" onclick="requestDelete('${song.id}', event)" title="Sil / Kaldır"><i class="fa-solid fa-trash"></i></button>
        `;
        
        if(editMode && currentSort === 'manual') {
            actionsHtml = `<button class="action-btn ${swapSourceId === song.id ? 'swap-mode' : ''}" onclick="handleSwap('${song.id}', event)" title="Yer Değiştir"><i class="fa-solid fa-sort"></i></button>` + actionsHtml;
        }
        
        div.innerHTML = `
            <div class="song-index" style="cursor:pointer;" onclick="playSong('${song.id}')">${index + 1}</div>
            <div class="song-cover"><i class="fa-solid fa-music"></i></div>
            <div class="song-title" style="cursor:pointer;" onclick="playSong('${song.id}')" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
            <div class="song-artist" title="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</div>
            <div class="song-actions">${actionsHtml}</div>
        `;
        
        loadCoverForElement(song.id, div.querySelector('.song-cover'));
        el.songList.appendChild(div);
    });
}

function loadCoverForElement(songId, element) {
    const req = getStore('covers').get(songId);
    req.onsuccess = () => { if(req.result) element.innerHTML = `<img src="${req.result.dataURL}">`; };
}

function renderPlaylistsSidebar() {
    el.playlistsContainer.innerHTML = '';
    playlists.forEach(p => {
        const container = document.createElement('div');
        container.className = 'playlist-item';
        
        const nameBtn = document.createElement('button');
        nameBtn.className = 'playlist-name';
        nameBtn.innerHTML = `<i class="fa-solid fa-list-music" style="margin-right:8px"></i> ${escapeHtml(p.name)}`;
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
        container.appendChild(nameBtn);
        container.appendChild(actionsDiv);
        el.playlistsContainer.appendChild(container);
    });
}

// ==================== OYNATICI KONTROLLERİ ====================
async function playSong(id) {
    const song = songs.find(s => s.id === id);
    if(!song) { showToast("Şarkı bulunamadı!"); return; }
    
    if(audio.src) URL.revokeObjectURL(audio.src);
    if(song.blob) {
        audio.src = URL.createObjectURL(song.blob);
        audio.dataset.currentId = song.id;
    } else { showToast("Ses dosyası bulunamadı!"); return; }
    
    currentSongIndex = currentSongsList.findIndex(s => s.id === id);
    el.playerTitle.innerText = song.title;
    el.playerTitle.title = song.title;
    el.playerArtist.innerText = song.artist;
    
    const req = getStore('covers').get(song.id);
    req.onsuccess = () => {
        if(req.result) el.playerCover.innerHTML = `<img src="${req.result.dataURL}">`;
        else el.playerCover.innerHTML = `<i class="fa-solid fa-music"></i>`;
    };
    
    audio.play().catch(err => console.error("Çalma hatası:", err));
    isPlaying = true;
    addToRecentlyPlayed(song.id);
    updatePlayPauseUI();
    renderSongList(currentSongsList);
    updateMediaSession(song);
}

function togglePlay() {
    if(!audio.src) { 
        if(currentSongsList.length > 0) playSong(currentSongsList[0].id); 
        return; 
    }
    if(isPlaying) { audio.pause(); isPlaying = false; }
    else { audio.play(); isPlaying = true; }
    updatePlayPauseUI();
}

function playNext() {
    if(queue.length > 0) { 
        const nextId = queue.shift(); 
        playSong(nextId); 
        if(currentView === 'queue') switchView('queue'); 
        return; 
    }
    if(currentSongsList.length === 0) return;
    
    if(shuffleMode) { 
        const randomIndex = Math.floor(Math.random() * currentSongsList.length); 
        playSong(currentSongsList[randomIndex].id); 
        return; 
    }
    
    let nextIndex = currentSongIndex + 1;
    if(nextIndex >= currentSongsList.length) { 
        if(repeatMode === 1) nextIndex = 0; 
        else return; 
    }
    playSong(currentSongsList[nextIndex].id);
}

function playPrev() {
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
        el.progressRange.value = percent;
        el.timeCurrentSpan.innerText = formatTime(audio.currentTime);
        el.timeTotalSpan.innerText = formatTime(audio.duration);
        
        // Geçmişe kaydetme (Şarkı 10 sn çaldıysa)
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
    
    el.progressRange.addEventListener('input', (e) => {
        if (audio.duration) {
            const newTime = (e.target.value / 100) * audio.duration;
            audio.currentTime = newTime;
            el.timeCurrentSpan.innerText = formatTime(newTime);
        }
    });
}

function updateMediaSession(song) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ 
            title: song.title, 
            artist: song.artist, 
            album: 'FK Müzik' 
        });
        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('previoustrack', playPrev);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }
}

// ==================== GÖRÜNÜM YÖNETİMİ (VIEWS) ====================
function switchView(view) {
    currentView = view;
    swapSourceId = null;
    
    // Aktif menü öğesini güncelle
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
    const sidebarItem = document.querySelector(`.menu-item[data-view="${view}"]`);
    if(sidebarItem) sidebarItem.classList.add('active');
    
    // Yedekleme paneli ve şarkı listesi görünürlüğünü yönet
    const isBackupView = (view === 'backup');
    
    // Liste kontrolleri ve başlıkları göster/gizle
    if (el.listControlsBar) {
        if (isBackupView || ['history', 'queue', 'recent'].includes(view)) {
            el.listControlsBar.style.display = 'none';
        } else {
            el.listControlsBar.style.display = 'flex';
        }
    }
    
    if (el.listHeader) {
        el.listHeader.style.display = isBackupView ? 'none' : '';
    }
    
    if (el.searchBoxContainer) {
        el.searchBoxContainer.style.display = isBackupView ? 'none' : '';
    }
    
    // Şarkı listesi ve yedekleme panelini göster/gizle
    el.songList.style.display = isBackupView ? 'none' : '';
    el.backupPanel.style.display = isBackupView ? 'block' : 'none';
    
    const bannerDiv = document.getElementById('list-banner');
    if (bannerDiv) bannerDiv.style.display = 'none'; // Default hidden
    
    // Yedekleme panelini oluştur
    if (isBackupView) {
        el.viewTitle.innerText = "Yedekleme";
        renderBackupPanel();
        closeSidebar();
        return;
    }
    
    // Diğer görünümler
    if(view === 'all') { 
        el.viewTitle.innerText = "Tüm Şarkılar"; 
        renderSongList(songs);
    }
    else if(view === 'favorites') { 
        el.viewTitle.innerText = "Favoriler"; 
        renderSongList(songs.filter(s => s.isFavorite));
    }
    else if(view === 'history') { 
        el.viewTitle.innerText = "Geçmiş"; 
        loadHistory();
    }
    else if(view === 'queue') {
        el.viewTitle.innerText = "Sıram";
        renderSongList(queue.map(id => songs.find(s => s.id === id)).filter(Boolean));
    }
    else if(view === 'recent') {
        el.viewTitle.innerText = "Son Çalınanlar";
        renderSongList(recentlyPlayed.map(id => songs.find(s => s.id === id)).filter(Boolean));
    }
    else if(view.startsWith('playlist_')) {
        const playlistId = view.split('_')[1];
        const p = playlists.find(p => p.id === playlistId);
        if(p) {
            el.viewTitle.innerText = p.name;
            renderSongList(p.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean));
            updatePlaylistBanner(playlistId);
            const updateBtn = document.getElementById('btn-update-cover');
            if (updateBtn) updateBtn.onclick = () => selectCoverForPlaylist(playlistId);
        }
    }
    closeSidebar();
}

function renderBackupPanel() {
    el.backupPanel.innerHTML = `
        <!-- Bölüm 1: Yedeği Çıkar -->
        <div class="backup-section">
            <h3><i class="fa-solid fa-cloud-arrow-up"></i> Yedeği Çıkar</h3>
            <p class="desc">
                Şarkılarınızın yedeğini almak için <strong>FK Zip</strong> aracını kullanın. 
                Tüm şarkı dosyalarınızı (.mp3, .wav, vb.) FK Zip sitesine yükleyin, 
                bir ZIP dosyası oluşturun ve indirin.
            </p>
            <div class="backup-link-box">
                <span class="link-text" id="fk-zip-link-text">https://file-to-zip-two.vercel.app</span>
                <button class="copy-btn" id="btn-copy-zip-link">
                    <i class="fa-solid fa-copy"></i> Linki Kopyala
                </button>
            </div>
            <ul class="backup-steps">
                <li><span class="step-no">1.</span> Linke tıklayarak FK Zip'i açın.</li>
                <li><span class="step-no">2.</span> Şarkı dosyalarınızı sürükleyip bırakın veya seçin.</li>
                <li><span class="step-no">3.</span> ZIP için bir isim belirleyin (isteğe bağlı ikon ekleyin).</li>
                <li><span class="step-no">4.</span> 'ZIP Oluştur ve İndir' butonuna basın.</li>
            </ul>
        </div>
        
        <!-- Bölüm 2: Yedekten Geri Yükle -->
        <div class="backup-section">
            <h3><i class="fa-solid fa-cloud-arrow-down"></i> Yedekten Geri Yükle</h3>
            <p class="restore-desc">
                Daha önce oluşturduğunuz ZIP yedek dosyasını seçin ve şarkılarınızı geri yükleyin.
                ZIP içindeki ses dosyaları (.mp3, .wav, .ogg, .flac, .m4a, .aac, .wma) otomatik olarak tanınır.
            </p>
            <div class="restore-actions">
                <button class="restore-btn" id="btn-select-zip">
                    <i class="fa-solid fa-folder-open"></i> ZIP Dosyası Seç
                </button>
                <button class="restore-btn" id="btn-restore-zip" disabled>
                    <i class="fa-solid fa-rotate"></i> ZIP Seç ve Geri Yükle
                </button>
            </div>
            <div id="restore-status" class="restore-status"></div>
        </div>
    `;
    
    // Olay dinleyicilerini bağla
    setupBackupPanelListeners();
    
    // ZIP input değişikliğini dinle
    const zipInput = document.getElementById('zip-restore-input');
    zipInput.addEventListener('change', handleZipFileSelection);
}

function setupBackupPanelListeners() {
    // FK Zip linkini kopyala
    const copyBtn = document.getElementById('btn-copy-zip-link');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const linkText = document.getElementById('fk-zip-link-text').innerText;
            navigator.clipboard.writeText(linkText)
                .then(() => showToast('Link kopyalandı!'))
                .catch(() => showToast('Kopyalanamadı.'));
        });
    }
    
    // ZIP dosyası seçme butonu
    const selectBtn = document.getElementById('btn-select-zip');
    if (selectBtn) {
        selectBtn.addEventListener('click', () => {
            document.getElementById('zip-restore-input').click();
        });
    }
    
    // Geri yükleme butonu
    const restoreBtn = document.getElementById('btn-restore-zip');
    if (restoreBtn) {
        restoreBtn.addEventListener('click', () => {
            const zipInput = document.getElementById('zip-restore-input');
            if (zipInput.files && zipInput.files.length > 0) {
                restoreFromZip(zipInput.files[0]);
            }
        });
    }
}

function handleZipFileSelection(event) {
    const file = event.target.files[0];
    const restoreBtn = document.getElementById('btn-restore-zip');
    const statusEl = document.getElementById('restore-status');
    
    if (file && file.name.toLowerCase().endsWith('.zip')) {
        restoreBtn.disabled = false;
        restoreBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> "${file.name}" Geri Yükle`;
        statusEl.className = 'restore-status show';
        statusEl.innerHTML = `<i class="fa-solid fa-file-zipper"></i> ${file.name} seçildi. Geri yüklemeye hazır.`;
    } else {
        restoreBtn.disabled = true;
        restoreBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> ZIP Seç ve Geri Yükle`;
        statusEl.className = 'restore-status';
        if (file) {
            statusEl.className = 'restore-status show error';
            statusEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Lütfen geçerli bir .zip dosyası seçin.';
        }
    }
}

function updatePlaylistBanner(playlistId) {
    const playlist = playlists.find(p => p.id === playlistId);
    const bannerDiv = document.getElementById('list-banner');
    const bannerImg = document.getElementById('banner-img');
    if (!playlist || !currentView.startsWith('playlist_')) return;
    
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

// ==================== İŞLEMLER VE MODALLAR ====================
async function toggleFavorite(id, e) {
    e.stopPropagation();
    const song = songs.find(s => s.id === id);
    song.isFavorite = !song.isFavorite;
    await putToStore('songs', song);
    renderSongList(currentSongsList);
}

function addToQueue(id, e) {
    e.stopPropagation();
    queue.push(id);
    showToast("Sıraya eklendi");
    if(currentView === 'queue') switchView('queue');
}

async function editSong(id, e) {
    e.stopPropagation();
    const song = songs.find(s => s.id === id);
    if(!song) return;
    const newTitle = prompt("Şarkı adını girin:", song.title);
    if(newTitle !== null && newTitle.trim() !== "") song.title = newTitle.trim();
    const newArtist = prompt("Sanatçı adını girin:", song.artist);
    if(newArtist !== null && newArtist.trim() !== "") song.artist = newArtist.trim();
    await putToStore('songs', song);
    renderSongList(currentSongsList);
    if(audio.dataset.currentId === id) {
        el.playerTitle.innerText = song.title;
        el.playerArtist.innerText = song.artist;
    }
    showToast("Şarkı güncellendi.");
}

async function handleSwap(id, e) {
    e.stopPropagation();
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

// Uyku Zamanlayıcı
function cancelSleepTimer() {
    if (sleepTimerInterval) { clearInterval(sleepTimerInterval); sleepTimerInterval = null; }
    sleepEndTime = null;
    document.getElementById('sleep-timer-display').innerText = "";
    document.getElementById('btn-cancel-sleep-timer').style.display = 'none';
    document.getElementById('btn-sleep-timer').classList.remove('active');
}

function startSleepTimer(minutes) {
    cancelSleepTimer();
    document.getElementById('btn-sleep-timer').classList.add('active');
    document.getElementById('btn-cancel-sleep-timer').style.display = 'inline-flex';
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
            document.getElementById('sleep-timer-display').innerText = `⏳ Kalan: ${m}:${s < 10 ? '0'+s : s}`;
        }
    }, 1000);
}

// İstatistikler
function showStats() {
    const totalSongs = songs.length;
    let totalSeconds = 0;
    for (const song of songs) {
        if (song.duration && typeof song.duration === 'number') totalSeconds += song.duration;
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    const artistCount = new Map();
    for (const song of songs) {
        const artist = song.artist || "Bilinmeyen Sanatçı";
        artistCount.set(artist, (artistCount.get(artist) || 0) + 1);
    }
    let topArtist = "Veri yok", topCount = 0;
    for (const [artist, count] of artistCount.entries()) {
        if (count > topCount) { topCount = count; topArtist = artist; }
    }
    
    document.getElementById('stats-content').innerHTML = `
        <p><strong>🎵 Toplam şarkı:</strong> ${totalSongs}</p>
        <p><strong>⏱️ Toplam çalma süresi:</strong> ${hours} saat ${minutes} dakika</p>
        <p><strong>🏆 En çok dinlenen sanatçı:</strong> ${topArtist} (${topCount} şarkı)</p>
    `;
    openModal('modal-stats');
}

// Tema Yönetimi
function initTheme() {
    const saved = localStorage.getItem('fk_theme') || 'dark';
    document.body.setAttribute('data-theme', saved);
}

function initAccentColor() {
    const savedColor = localStorage.getItem('fk_accent_color') || '#1DB954';
    document.documentElement.style.setProperty('--accent', savedColor);
    document.querySelectorAll('.color-option').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-color') === savedColor);
    });
}

function setAccentColor(color) {
    document.documentElement.style.setProperty('--accent', color);
    localStorage.setItem('fk_accent_color', color);
    document.querySelectorAll('.color-option').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-color') === color);
    });
}

// ==================== OLAY DİNLEYİCİLERİ ====================
function setupEventListeners() {
    // Menü
    document.getElementById('btn-menu').onclick = () => { el.sidebar.classList.add('open'); el.overlay.classList.add('show'); };
    document.getElementById('close-sidebar').onclick = closeSidebar;
    el.overlay.onclick = closeSidebar;
    
    // Şarkı Ekleme Dropdown
    document.getElementById('btn-upload-menu').onclick = (e) => { e.stopPropagation(); document.getElementById('upload-options').classList.toggle('show'); };
    document.onclick = (e) => { if(!e.target.closest('.upload-dropdown')) document.getElementById('upload-options').classList.remove('show'); };
    
    // Dosya/Klasör Seçimi
    document.getElementById('btn-add-files').onclick = () => el.fileUpload.click();
    document.getElementById('btn-add-folder').onclick = () => el.folderUpload.click();
    el.fileUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    el.folderUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    
    // Yan Menü Bağlantıları
    document.querySelectorAll('.menu-item[data-view]').forEach(btn => {
        btn.onclick = () => switchView(btn.dataset.view);
    });
    
    // Alt Oynatıcı Butonları
    el.playBtn.onclick = togglePlay; 
    el.nextBtn.onclick = playNext; 
    el.prevBtn.onclick = playPrev;
    el.shuffleBtn.onclick = () => { shuffleMode = !shuffleMode; el.shuffleBtn.classList.toggle('active', shuffleMode); };
    el.repeatBtn.onclick = () => {
        repeatMode = (repeatMode + 1) % 3;
        if(repeatMode === 0) { el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>'; el.repeatBtn.classList.remove('active'); }
        else if(repeatMode === 1) { el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>'; el.repeatBtn.classList.add('active'); }
        else { el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat-1"></i>'; el.repeatBtn.classList.add('active'); }
    };
    
    // Arama
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

    // Sıralama
    const btnSort = document.getElementById('btn-sort');
    const sortOptions = document.getElementById('sort-options');
    btnSort.onclick = (e) => { e.stopPropagation(); sortOptions.classList.toggle('show'); };
    document.querySelectorAll('#sort-options button').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
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
            }
            sortOptions.classList.remove('show');
        };
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.sort-dropdown')) sortOptions.classList.remove('show'); });

    // Düzenleme Modu
    el.btnEditMode.onclick = () => {
        if(currentSort !== 'manual') { showToast("Sadece 'Benim Sıralamam' seçiliyken çalışır."); return; }
        editMode = !editMode;
        el.btnEditMode.classList.toggle('active', editMode);
        swapSourceId = null;
        renderSongList(currentSongsList);
    };

    // Tema Değiştirme
    document.getElementById('btn-theme-toggle').onclick = () => {
        const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', next); 
        localStorage.setItem('fk_theme', next);
    };

    // Renk Seçimi
    document.querySelectorAll('.color-option').forEach(btn => {
        btn.onclick = () => { setAccentColor(btn.getAttribute('data-color')); closeSidebar(); };
    });
    
    // Uyku Modu Dinleyicileri
    document.getElementById('btn-sleep-timer').onclick = () => openModal('modal-sleep-timer');
    document.getElementById('btn-cancel-sleep-timer').onclick = cancelSleepTimer;
    document.getElementById('btn-cancel-timer').onclick = () => { cancelSleepTimer(); closeModal('modal-sleep-timer'); };
    
    document.querySelectorAll('.timer-btn[data-time]').forEach(btn => {
        btn.onclick = (e) => {
            const time = parseInt(btn.getAttribute('data-time'));
            if (time > 0) startSleepTimer(time);
            closeModal('modal-sleep-timer');
        };
    });
    
    document.getElementById('btn-custom-timer').onclick = () => {
        let minutes = prompt("Dakika cinsinden süre girin (1-999):", "30");
        if (minutes !== null) {
            minutes = parseInt(minutes);
            if (!isNaN(minutes) && minutes > 0) startSleepTimer(minutes);
            else showToast("Geçerli bir süre giriniz.");
        }
        closeModal('modal-sleep-timer');
    };
    
    // Playlist Oluşturma & Kapak İşlemleri
    document.getElementById('btn-create-playlist').onclick = () => {
        document.getElementById('playlist-name-input').value = '';
        pendingPlaylistCover = null;
        document.getElementById('playlist-cover-preview').style.backgroundImage = '';
        openModal('modal-create-playlist');
    };
    
    document.getElementById('btn-select-playlist-cover').onclick = () => document.getElementById('playlist-cover-input').click();
    document.getElementById('btn-confirm-create-playlist').onclick = async () => {
        const name = document.getElementById('playlist-name-input').value.trim();
        if(!name) return;
        const p = { id: Date.now().toString(), name, songIds: [] };
        if (pendingPlaylistCover) {
            try { localStorage.setItem('fk_playlist_cover_' + p.id, pendingPlaylistCover); } 
            catch(e) { showToast("Resim çok büyük, kaydedilemedi!"); }
        }
        await putToStore('playlists', p);
        playlists.push(p);
        renderPlaylistsSidebar();
        closeModal('modal-create-playlist');
        pendingPlaylistCover = null;
    };

    // Playlist Kapak Seçim Inputu
    document.getElementById('playlist-cover-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const resizedDataUrl = await resizeImage(ev.target.result);
                if (currentPlaylistIdForCover) {
                    try { localStorage.setItem('fk_playlist_cover_' + currentPlaylistIdForCover, resizedDataUrl); showToast("Kapak güncellendi"); }
                    catch(e) { showToast("Resim çok büyük!"); }
                    if (currentView === `playlist_${currentPlaylistIdForCover}`) updatePlaylistBanner(currentPlaylistIdForCover);
                    currentPlaylistIdForCover = null;
                } else {
                    pendingPlaylistCover = resizedDataUrl;
                    document.getElementById('playlist-cover-preview').style.backgroundImage = `url(${pendingPlaylistCover})`;
                }
            };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    });

    // Şarkı Kapağı Değiştirme
    el.playerCover.addEventListener('click', () => { if(audio.dataset.currentId) el.coverUpload.click(); });
    el.coverUpload.addEventListener('change', (e) => {
        const file = e.target.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const resized = await resizeImage(ev.target.result);
            await putToStore('covers', { songId: audio.dataset.currentId, dataURL: resized });
            el.playerCover.innerHTML = `<img src="${resized}">`;
            renderSongList(currentSongsList);
        };
        reader.readAsDataURL(file);
    });

    // Silme ve İstatistik İşlemleri
    document.getElementById('btn-stats').onclick = () => { showStats(); closeSidebar(); };
    document.getElementById('btn-delete-all-songs').onclick = async () => {
        if(confirm("Tüm şarkılar silinecek. Emin misiniz?")) {
            await clearStore('songs'); await clearStore('covers'); await clearStore('history');
            for (let p of playlists) { p.songIds = []; await putToStore('playlists', p); }
            queue = []; songs = []; recentlyPlayed = []; saveRecentlyPlayed();
            if (audio.src) { audio.pause(); audio.src = ''; el.playerTitle.innerText = "Şarkı Seçilmedi"; }
            switchView('all'); calculateStorage(); showToast("Tüm şarkılar silindi.");
        }
    };
    document.getElementById('btn-delete-all-playlists').onclick = async () => {
        if(confirm("Tüm listeler silinecek. Emin misiniz?")) {
            playlists.forEach(p => localStorage.removeItem('fk_playlist_cover_' + p.id));
            await clearStore('playlists'); playlists = []; renderPlaylistsSidebar(); switchView('all');
        }
    };
    document.getElementById('btn-clear-all-favorites').onclick = async () => {
        if(confirm("Favoriler temizlenecek. Emin misiniz?")) {
            for (let song of songs) { song.isFavorite = false; await putToStore('songs', song); }
            switchView(currentView); showToast("Favoriler temizlendi.");
        }
    };
    
    // Sanatçı Listesi (Otomatik Playlist)
    document.getElementById('btn-artist-playlist').onclick = () => {
        const artistSet = new Set();
        songs.forEach(song => { if (song.artist) artistSet.add(song.artist); });
        const container = document.getElementById('artist-list-container');
        container.innerHTML = '';
        if(artistSet.size === 0) container.innerHTML = '<div style="padding: 20px; text-align: center;">Henüz hiç sanatçı yok.</div>';
        Array.from(artistSet).sort().forEach(artist => {
            const btn = document.createElement('button');
            btn.innerText = artist; btn.className = "artist-list-item";
            btn.onclick = async () => {
                const songIds = songs.filter(s => s.artist === artist).map(s => s.id);
                const p = { id: Date.now().toString(), name: `🎤 ${artist}`, songIds };
                await putToStore('playlists', p); playlists.push(p);
                renderPlaylistsSidebar(); showToast(`${artist} eklendi.`); closeModal('modal-artist-list');
            };
            container.appendChild(btn);
        });
        openModal('modal-artist-list'); closeSidebar();
    };
    
    // Tekil Şarkı Silme Modalı İşlemleri
    document.getElementById('btn-confirm-delete').onclick = async () => {
        if(!songToDeleteId) return;
        if(currentView === 'all') {
            await deleteFromStore('songs', songToDeleteId);
            songs = songs.filter(s => s.id !== songToDeleteId);
            await deleteFromStore('covers', songToDeleteId);
            recentlyPlayed = recentlyPlayed.filter(id => id !== songToDeleteId);
            saveRecentlyPlayed();
        } else if(currentView === 'favorites') {
            const song = songs.find(s => s.id === songToDeleteId);
            song.isFavorite = false; await putToStore('songs', song);
        } else if(currentView === 'queue') {
            queue = queue.filter(id => id !== songToDeleteId);
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
    
    // ZIP geri yükleme input olayı
    const zipRestoreInput = document.getElementById('zip-restore-input');
    if (zipRestoreInput) {
        zipRestoreInput.addEventListener('change', handleZipFileSelection);
    }
}

let songToDeleteId = null;
function requestDelete(id, e) {
    e.stopPropagation();
    songToDeleteId = id;
    let text = "Bu şarkıyı tamamen silmek istediğinize emin misiniz?";
    if(currentView === 'favorites') text = "Favorilerden çıkarmak istiyor musunuz?";
    else if(currentView === 'queue') text = "Sıradan çıkarmak istiyor musunuz?";
    else if(currentView === 'history') text = "Geçmişten kaldırmak istiyor musunuz?";
    else if(currentView.startsWith('playlist_')) text = "Listeden çıkarmak istiyor musunuz?";
    
    document.getElementById('delete-warning-text').innerText = text;
    openModal('modal-confirm-delete');
}

let songToAddId = null;
function openAddToPlaylistModal(id, e) {
    e.stopPropagation();
    songToAddId = id;
    const listEl = document.getElementById('modal-playlist-list');
    listEl.innerHTML = '';
    playlists.forEach(p => {
        const btn = document.createElement('button'); 
        btn.innerText = p.name;
        btn.className = "playlist-add-btn";
        btn.onclick = async () => {
            if(!p.songIds.includes(songToAddId)) { p.songIds.push(songToAddId); await putToStore('playlists', p); showToast("Eklendi."); }
            closeModal('modal-add-to-playlist');
        };
        listEl.appendChild(btn);
    });
    openModal('modal-add-to-playlist');
}

function shareSong(songId, e) {
    e.stopPropagation();
    const song = songs.find(s => s.id === songId);
    if(!song) return;
    document.getElementById('share-text').value = `🎵 FK Müzik'te dinliyorum: ${song.title} - ${song.artist}`;
    
    const copyBtn = document.getElementById('btn-copy-share');
    const newCopyBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
    
    newCopyBtn.onclick = () => {
        navigator.clipboard.writeText(document.getElementById('share-text').value)
            .then(() => { showToast("Kopyalandı!"); closeModal('modal-share'); })
            .catch(() => showToast("Başarısız oldu."));
    };
    openModal('modal-share');
}

// Yardımcılar
function closeSidebar() { el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); }
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
async function loadHistory() {
    const hist = await getAllFromStore('history');
    hist.sort((a, b) => b.timestamp - a.timestamp);
    renderSongList(hist.map(h => songs.find(s => s.id === h.id)).filter(Boolean));
}
async function saveToHistory(id) { await putToStore('history', { id, timestamp: Date.now() }); }
async function editPlaylist(playlistId) {
    const p = playlists.find(p => p.id === playlistId);
    const newName = prompt("Liste adını girin:", p.name);
    if(newName && newName.trim() !== "") { p.name = newName.trim(); await putToStore('playlists', p); renderPlaylistsSidebar(); switchView(currentView); }
}
async function deletePlaylist(playlistId) {
    if(confirm("Listeyi silmek istediğinize emin misiniz?")) {
        await deleteFromStore('playlists', playlistId);
        playlists = playlists.filter(p => p.id !== playlistId);
        localStorage.removeItem('fk_playlist_cover_' + playlistId);
        renderPlaylistsSidebar(); if(currentView === `playlist_${playlistId}`) switchView('all');
    }
}
function selectCoverForPlaylist(playlistId) { currentPlaylistIdForCover = playlistId; document.getElementById('playlist-cover-input').click(); }