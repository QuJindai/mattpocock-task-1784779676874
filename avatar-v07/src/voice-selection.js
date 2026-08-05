export function voiceId(voice) {
  if (!voice) return '';
  return String(voice.voiceURI || `${voice.name || ''}|${voice.lang || ''}`);
}

export function describeVoice(voice) {
  return {
    id: voiceId(voice),
    name: String(voice?.name || ''),
    lang: String(voice?.lang || ''),
    localService: Boolean(voice?.localService),
    default: Boolean(voice?.default),
  };
}

export function selectVoice(voices, requestedId = '', language = 'zh-CN') {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];
  if (!list.length) return null;
  const requested = String(requestedId || '').trim();
  if (requested) {
    const explicit = list.find((voice) => voiceId(voice) === requested);
    if (explicit) return explicit;
  }
  const normalizedLanguage = String(language || 'zh-CN').toLowerCase();
  const exactLocal = list.find((voice) =>
    Boolean(voice.localService) && String(voice.lang || '').toLowerCase() === normalizedLanguage,
  );
  if (exactLocal) return exactLocal;
  const chinese = list.find((voice) => String(voice.lang || '').toLowerCase().startsWith('zh'));
  if (chinese) return chinese;
  const defaultVoice = list.find((voice) => Boolean(voice.default));
  return defaultVoice || list[0];
}
