(function () {
const zdm = window.zdm;
const $ = (id) => document.getElementById(id);
let videos = [];
let probing = false;

function esc(value) {
  return String(value || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const s = Math.round(seconds);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function formatSize(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
}

function videoLabel(height) {
  if (height >= 2160) return '4K';
  if (height >= 1440) return '1440p';
  return height + 'p';
}

function pickVideo(video, choice) {
  const list = video.videoFormats || [];
  if (!list.length) return 0;
  if (choice === 'max') return list[0].height;
  const height = Number(choice);
  const match = list.find((item) => item.height === height) || list.find((item) => item.height <= height) || list[0];
  return match.height;
}

function pickAudio(video, choice) {
  const list = video.audioFormats || [];
  if (!list.length) return 0;
  if (choice === 'max') return list[0].abr;
  const abr = Number(choice);
  const match = list.find((item) => item.abr === abr) || list.find((item) => item.abr && item.abr <= abr) || list[0];
  return match.abr;
}

function rowBytes(video) {
  const audio = (video.audioFormats || []).find((item) => item.abr === video.audioAbr) || (video.audioFormats || [])[0];
  if ($('only-audio').checked) return audio ? audio.size : 0;
  const picture = (video.videoFormats || []).find((item) => item.height === video.videoHeight) || (video.videoFormats || [])[0];
  return (picture ? picture.size : 0) + (audio ? audio.size : 0);
}

function fillSelect(select, values, label, current) {
  const next = values.includes(current) ? current : values[0];
  select.innerHTML = values.map((value) => `<option value="${esc(value)}">${esc(label(value))}</option>`).join('');
  select.value = next;
}

function syncGlobals() {
  const heights = [...new Set(videos.flatMap((video) => (video.videoFormats || []).map((item) => item.height)))].sort((a, b) => b - a);
  const rates = [...new Set(videos.flatMap((video) => (video.audioFormats || []).map((item) => item.abr)).filter(Boolean))].sort((a, b) => b - a);
  fillSelect($('video-quality'), ['max', ...heights.map(String)], (value) => (value === 'max' ? 'Highest' : videoLabel(Number(value))), $('video-quality').value || 'max');
  fillSelect($('audio-quality'), ['max', ...rates.map(String)], (value) => (value === 'max' ? 'Highest' : value + ' kbps'), $('audio-quality').value || 'max');
}

function applyGlobals() {
  videos.forEach((video) => {
    video.videoHeight = pickVideo(video, $('video-quality').value || 'max');
    video.audioAbr = pickAudio(video, $('audio-quality').value || 'max');
  });
}

function paint() {
  const list = $('video-list');
  const scroll = list.scrollTop;
  const only = $('only-audio').checked;
  list.innerHTML = `<div class="cols"><span></span><span>Title</span><span>Video</span><span>Audio</span><span>Size</span><span>Time</span></div>` + videos.map((video, index) => {
    const videosOptions = (video.videoFormats || []).map((item) => `<option value="${item.height}" ${item.height === video.videoHeight ? 'selected' : ''}>${videoLabel(item.height)}</option>`).join('') || '<option value="">…</option>';
    const audioOptions = (video.audioFormats || []).map((item) => `<option value="${item.abr}" ${item.abr === video.audioAbr ? 'selected' : ''}>${item.abr ? item.abr + ' kbps' : item.ext}</option>`).join('') || '<option value="">…</option>';
    return `<div class="item">
      <input type="checkbox" data-kind="check" data-index="${index}" ${video.checked ? 'checked' : ''}>
      <span class="title" title="${esc(video.title)}">${esc(video.title)}</span>
      <select data-kind="video" data-index="${index}" ${only ? 'disabled' : ''}>${videosOptions}</select>
      <select data-kind="audio" data-index="${index}">${audioOptions}</select>
      <span class="meta">${formatSize(rowBytes(video))}</span>
      <span class="meta">${formatDuration(video.duration)}</span>
    </div>`;
  }).join('');
  list.scrollTop = scroll;
  const selected = videos.filter((video) => video.checked);
  const total = selected.reduce((sum, video) => sum + rowBytes(video), 0);
  const ready = videos.filter((video) => video.videoFormats || video.audioFormats).length;
  $('status').textContent = videos.length
    ? `${selected.length} selected · Total ${formatSize(total)}` + (ready < videos.length ? ` · reading ${ready}/${videos.length}` : '')
    : '';
}

function optionsOf(video) {
  const picture = (video.videoFormats || []).find((item) => item.height === video.videoHeight) || (video.videoFormats || [])[0];
  const audio = (video.audioFormats || []).find((item) => item.abr === video.audioAbr) || (video.audioFormats || [])[0];
  return {
    url: video.url,
    title: video.title,
    id: video.id,
    videoId: picture ? picture.id : '',
    audioId: audio ? audio.id : '',
    audioExt: audio ? audio.ext : 'm4a',
  };
}

async function probeAll() {
  probing = true;
  let cursor = 0;
  async function worker() {
    while (cursor < videos.length) {
      const index = cursor;
      cursor += 1;
      const video = videos[index];
      try {
        const info = await zdm.invoke('playlist:formats', video.url);
        video.videoFormats = info.videos || [];
        video.audioFormats = info.audios || [];
        video.videoHeight = pickVideo(video, $('video-quality').value || 'max');
        video.audioAbr = pickAudio(video, $('audio-quality').value || 'max');
      } catch {
        video.videoFormats = [];
        video.audioFormats = [];
      }
      syncGlobals();
      paint();
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  probing = false;
  paint();
}

$('video-list').addEventListener('change', (e) => {
  const index = Number(e.target.dataset.index);
  if (!videos[index]) return;
  if (e.target.dataset.kind === 'check') videos[index].checked = e.target.checked;
  if (e.target.dataset.kind === 'video') videos[index].videoHeight = Number(e.target.value);
  if (e.target.dataset.kind === 'audio') videos[index].audioAbr = Number(e.target.value);
  paint();
});

$('check-all').addEventListener('change', () => {
  videos.forEach((video) => { video.checked = $('check-all').checked; });
  paint();
});

$('video-quality').addEventListener('change', () => { applyGlobals(); paint(); });
$('audio-quality').addEventListener('change', () => { applyGlobals(); paint(); });
$('only-audio').addEventListener('change', paint);

$('btn-load').addEventListener('click', async () => {
  const url = $('playlist-url').value.trim();
  if (!url || probing) return;
  $('status').textContent = 'Loading playlist…';
  $('btn-load').disabled = true;
  try {
    const entries = await zdm.invoke('playlist:list', url);
    videos = (entries || []).map((entry) => ({ ...entry, checked: true, videoFormats: null, audioFormats: null, videoHeight: 0, audioAbr: 0 }));
    $('check-all').checked = true;
    paint();
    if (videos[0]) {
      zdm.invoke('playlist:remember', { url, name: videos[0].playlistTitle || videos[0].title || 'Playlist' });
    }
    $('btn-load').disabled = false;
    await probeAll();
  } catch (err) {
    $('status').textContent = err.message || 'Could not read this playlist';
    $('btn-load').disabled = false;
  }
});

async function loadQueues() {
  const select = $('queue-target');
  if (!select) return;
  const current = select.value;
  let queues = [];
  try { queues = await zdm.invoke('playlist:queues') || []; } catch { queues = []; }
  select.innerHTML = '<option value="">Start now</option>'
    + queues.map((queue) => `<option value="${esc(queue.id)}">${esc(queue.name)}</option>`).join('')
    + '<option value="new">New queue…</option>';
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

$('queue-target').addEventListener('change', () => {
  $('new-queue-name').hidden = $('queue-target').value !== 'new';
});
$('queue-target').addEventListener('focus', loadQueues);
loadQueues();

$('btn-download').addEventListener('click', async () => {
  const picked = videos.filter((video) => video.checked);
  if (!picked.length) {
    $('status').textContent = 'Select at least one video';
    return;
  }
  let queueId = $('queue-target').value;
  if (queueId === 'new') {
    const name = $('new-queue-name').value.trim();
    if (!name) {
      $('status').textContent = 'Name the new queue';
      return;
    }
    const created = await zdm.invoke('playlist:create-queue', name);
    if (!created || !created.id) {
      $('status').textContent = 'Could not create the queue';
      return;
    }
    queueId = created.id;
    await loadQueues();
    $('queue-target').value = queueId;
    $('new-queue-name').hidden = true;
  }
  $('btn-download').disabled = true;
  $('status').textContent = 'Starting…';
  try {
    const result = await zdm.invoke('playlist:add', {
      videos: picked.map(optionsOf),
      onlyAudio: $('only-audio').checked,
      queueOnly: !!queueId,
      page: $('playlist-url').value.trim(),
    });
    if (queueId && result.ids && result.ids.length) await zdm.invoke('playlist:assign', { ids: result.ids, queueId });
    $('status').textContent = (result.added || 0) + ' added' + (result.failed ? ', ' + result.failed + ' failed' : '');
  } catch (err) {
    $('status').textContent = err.message || 'Could not start the downloads';
  } finally {
    $('btn-download').disabled = false;
  }
});

$('btn-close').addEventListener('click', () => window.close());
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  $('playlist-url').value = preset;
  $('btn-load').click();
}
$('playlist-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-load').click();
});
})();
