function normalizeZoomLaunchUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Zoom link / Meeting ID не задано в сесії захисту');

  if (/^zoommtg:\/\//i.test(raw)) return raw;

  const plainMeetingId = raw.replace(/\s+/g, '');
  if (/^\d{9,12}$/.test(plainMeetingId)) {
    return `zoommtg://zoom.us/join?action=join&confno=${encodeURIComponent(plainMeetingId)}`;
  }

  try {
    const url = new URL(raw);
    const pathMatch = url.pathname.match(/\/(?:j|wc)\/(\d{9,12})/);
    const confno = url.searchParams.get('confno') || pathMatch?.[1] || '';
    const pwd = url.searchParams.get('pwd') || url.searchParams.get('password') || '';
    if (confno) {
      const params = new URLSearchParams({ action: 'join', confno });
      if (pwd) params.set('pwd', pwd);
      return `zoommtg://zoom.us/join?${params.toString()}`;
    }
  } catch {
    // Fall through to the original value so custom enterprise Zoom links still work.
  }

  return raw;
}

module.exports = { normalizeZoomLaunchUrl };
