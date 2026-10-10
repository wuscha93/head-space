// Spracheingabe mit simulierter Spracherkennung des Browsers
import { beforeEach, describe, expect, test } from 'bun:test';

// Simulierte SpeechRecognition: Verhalten pro Test über `behaviour` steuerbar
type Behaviour = 'ok' | 'silent' | 'aborted' | 'throw';
let behaviour: Behaviour = 'ok';
let lastInstance: any = null;
let availableImpl: () => Promise<string> = async () => 'available';

class FakeSR extends EventTarget {
  processLocally = false; lang = ''; interimResults = false; continuous = true; maxAlternatives = 5;
  onresult: any; onerror: any; onend: any;
  constructor() { super(); lastInstance = this; }
  start() {
    if (behaviour === 'throw') throw Object.assign(new Error('busy'), { name: 'InvalidStateError' });
    this.dispatchEvent(new Event('start'));
    queueMicrotask(() => {
      if (behaviour === 'ok') {
        this.dispatchEvent(new Event('audiostart'));
        this.onresult?.({ results: [Object.assign([{ transcript: 'Hallo ' }], { isFinal: false })] });
        this.onresult?.({ results: [Object.assign([{ transcript: 'Hallo Welt' }], { isFinal: true })] });
      }
      if (behaviour === 'aborted') this.onerror?.({ error: 'aborted' });
      this.onend?.();
    });
  }
  stop() { this.onend?.(); }
  static available(..._a: unknown[]) { return availableImpl(); }
  static install() { return Promise.resolve(true); }
}
(globalThis as any).SpeechRecognition = FakeSR;

const V = await import('../../src/voice');

function run(local: boolean) {
  return new Promise<{ texts: string[]; end: [boolean, boolean, boolean]; errors: string[] }>((resolve) => {
    const texts: string[] = []; const errors: string[] = [];
    const ok = V.start('feld', local, {
      onText: (t) => texts.push(t),
      onError: (c) => errors.push(c),
      onEnd: (g, e, h) => resolve({ texts, end: [g, e, h], errors }),
    });
    if (!ok) resolve({ texts, end: [false, true, false], errors: ['start-failed'] });
  });
}

beforeEach(() => { behaviour = 'ok'; localStorage.clear(); V.resetLocalBroken(); availableImpl = async () => 'available'; });

describe('Aufnahme', () => {
  test('erkennt Text, Deutsch, eine Aufnahme mit Zwischenergebnissen', async () => {
    const r = await run(false);
    expect(lastInstance).toMatchObject({ lang: 'de-DE', interimResults: true, continuous: false, maxAlternatives: 1, processLocally: false });
    expect(r.texts).toEqual(['Hallo', 'Hallo Welt']);
    expect(r.end).toEqual([true, false, true]);
    expect(V.activeTarget).toBeNull();
  });
  test('offline: verlangt Erkennung auf dem Gerät', async () => {
    await run(true);
    expect(lastInstance.processLocally).toBe(true);
  });
  test('endet ohne Ergebnis: wird als Problem festgehalten', async () => {
    behaviour = 'silent';
    const r = await run(false);
    expect(r.end).toEqual([false, false, false]);
    expect(V.lastIssue.code).toBe('ended-without-result');
  });
  test('Abbruch durch den Browser wird gemeldet und protokolliert', async () => {
    behaviour = 'aborted';
    const r = await run(false);
    expect(r.errors).toEqual(['aborted']);
    expect(r.end).toEqual([false, true, false]);
    expect(V.lastIssue).toMatchObject({ code: 'aborted', mode: 'online' });
    expect(V.log.some((l) => l.includes('error: aborted'))).toBe(true);
    expect(V.ERRORS.aborted).toBeTruthy();
  });
  test('Start schlägt fehl: false und Eintrag im Protokoll', async () => {
    behaviour = 'throw';
    const r = await run(false);
    expect(r.errors).toEqual(['start-failed']);
    expect(V.lastIssue.code).toContain('InvalidStateError');
  });
  test('Protokoll enthält die Zwischenschritte', async () => {
    await run(true);
    const text = V.log.join('\n');
    expect(text).toContain('start (offline, de-DE)');
    expect(text).toContain('audiostart');
    expect(text).toContain('result (final): Hallo Welt');
    expect(text).toContain('end');
  });
});

describe('Offline-Verfügbarkeit', () => {
  test('wird geprüft und gemerkt', async () => {
    let calls = 0;
    availableImpl = async () => { calls++; return 'available'; };
    expect(await V.localAvailability()).toBe('available');
    expect(await V.localAvailability()).toBe('available');
    expect(calls).toBe(1);
  });
  test('hängende Abfrage: nach 3 Sekunden „unbekannt“', async () => {
    availableImpl = () => new Promise(() => {});
    expect(await V.localAvailability()).toBe('unknown');
  }, 5000);
  test('Absturzschutz: nach abgebrochener Abfrage wird nicht mehr gefragt', async () => {
    let calls = 0;
    availableImpl = async () => { calls++; return 'available'; };
    localStorage.setItem('kopf-frei-voice-probe', 'pending'); // als wäre die Seite dabei abgestürzt
    expect(await V.localAvailability()).toBe('unknown');
    expect(calls).toBe(0);
  });
  test('defekte Offline-Erkennung wird dauerhaft gemerkt und lässt sich zurücksetzen', () => {
    V.markLocalBroken();
    expect(V.lastAvailability()).toBe('unavailable');
    expect(localStorage.getItem('kopf-frei-voice-local-broken')).toBe('1');
    V.resetLocalBroken();
    expect(V.lastAvailability()).toBeNull();
  });
  test('Umgebungsangaben für die Fehlersuche', async () => {
    const env = await V.environment();
    expect(env.some((l) => l.startsWith('Browser:'))).toBe(true);
    expect(env.some((l) => l.startsWith('Modus:'))).toBe(true);
  });
});

describe('Ein/Aus', () => {
  test('Spracheingabe ist vorerst ausgeschaltet, lässt sich (für Tests) einschalten', () => {
    expect(V.enabled()).toBe(false);
    localStorage.setItem('kopf-frei-voice-enabled', '1');
    expect(V.enabled()).toBe(true);
    localStorage.removeItem('kopf-frei-voice-enabled');
  });
});
