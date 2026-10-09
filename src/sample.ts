// Beispieldaten für die Test-App: realistische Aufgaben, Projekte und Listen,
// mit Daten relativ zu heute (überfällig, heute, bald, später).

import * as S from './store';
import { addDays, today } from './logic';

export function seedSample() {
  const d = (n: number) => addDays(today(), n);
  S.batch(() => {
    const velo = S.createProject({ title: 'Velo winterfit machen', outcome: 'Service gemacht, Licht und Winterreifen montiert', due: d(14) });
    const ferien = S.createProject({ title: 'Ferien Tessin planen', outcome: 'Hotel und Zug für die Herbstferien gebucht' });
    const steuer = S.createProject({ title: 'Steuererklärung 2025 einreichen', outcome: 'Online eingereicht, Belege abgelegt', due: d(20) });
    const wohn = S.createProject({ title: 'Wohnzimmer streichen', outcome: 'Wände in Salbeigrün, Möbel wieder am Platz' });
    S.createProject({ title: 'Spanisch lernen', outcome: 'Einfache Gespräche in den Ferien führen', status: 'someday' });

    S.capture('Velomechaniker anrufen und Service-Termin vereinbaren', { list: 'next', context: '@Telefon', projectId: velo, due: d(2) });
    S.capture('Kette ölen und Bremsen prüfen', { list: 'next', context: '@Zuhause', projectId: velo, notes: 'Öl steht im Keller' });
    S.capture('Offerte für Winterreifen', { list: 'waiting', waitingFor: 'Velo Kurmann', projectId: velo, tickler: d(3) });
    S.capture('Hotel in Ascona: Zimmer mit Seesicht anfragen', { list: 'next', context: '@Telefon', projectId: ferien });
    S.capture('Zugverbindung Zürich–Locarno vergleichen', { list: 'next', context: '@Computer', projectId: ferien });
    S.capture('Belege 2025 einscannen und ablegen', { list: 'next', context: '@Computer', projectId: steuer, due: d(-1) });
    S.capture('Formular Wertschriftenverzeichnis ausfüllen', { list: 'next', context: '@Computer', projectId: steuer, tickler: d(5) });
    S.capture('Farbmuster an die Wand streichen', { list: 'next', context: '@Zuhause', projectId: wohn });
    S.capture('Abdeckband und Farbroller kaufen', { list: 'next', context: '@Unterwegs', projectId: wohn, due: d(10) });
    S.capture('Zahnarzt-Termin verschieben', { list: 'next', context: '@Telefon', due: today() });
    S.capture('Altglas wegbringen', { list: 'next', context: '@Unterwegs' });
    S.capture('Antwort von Lisa zur Grillparty', { list: 'waiting', waitingFor: 'Lisa', tickler: d(-1) });
    S.capture('Kochkurs mit Anna?', { list: 'someday' });
    S.capture('WLAN-Passwort Ferienhaus', { list: 'reference', notes: 'Netz: Casa-Ticino' });
    S.capture('Idee: Geschenk für Mama', {});
    S.capture('Zeitschrift-Abo kündigen?', {});
    S.capture('Artikel über Wochendurchsicht lesen', {});
  });
}
