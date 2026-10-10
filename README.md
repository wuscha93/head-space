# Kopf frei

Persönliche Aufgabenverwaltung nach *Getting Things Done* von David Allen.
Installierbare Web-App (PWA) für Android, iPad und Windows. Die Daten liegen auf dem Gerät; zwischen Geräten werden sie **verschlüsselt** über ein privates GitHub-Repository abgeglichen.

- **Live-App** (echte Daten): **https://wuscha93.github.io/head-space/**
- **Test-App** (Beispieldaten, kein Sync): **https://wuscha93.github.io/head-space/test/**

Neue Versionen landen zuerst in der Test-App und kommen erst nach Freigabe in die Live-App.

## Funktionen (Version 0.8.0)

- **Inbox** mit Schnellerfassung (Plus-Knopf, Taste `N` oder Spracheingabe)
- **Klär-Dialog** nach dem Ablaufdiagramm des Buchs
- **Kontexte als Symbole** (Computer, Telefon, Unterwegs, Zuhause, Büro, Besprechung; eigene Kontexte mit Etikett und Namen)
- **Listen**: Nächste Schritte (Kontext-Filter), Fristen, Projekte, Warten auf, Wiedervorlage, Irgendwann/Vielleicht, Referenz, Erledigt, Papierkorb
- **Projekte** mit Ziel, Frist und Farbe; Schritte nach Frist sortiert oder per Griff ⋮⋮ selbst geordnet (Warndreieck, wenn die Reihenfolge einer Frist widerspricht); Wahl „Alle“ oder „Nur die nächste“ für die Liste Nächste Schritte; Frist gleich beim Hinzufügen; beim Erledigen des letzten Schritts fragt die App nach dem nächsten
- **Fälligkeitsdatum** (Fahne) direkt in der Karte, **Wiedervorlage** („Erst ab“ mit Sanduhr, „Nachfassen“ mit Glocke), jeweils mit kleinem Titel
- **Rückgängig** (3 Sekunden) nach Erledigen, Löschen, Verschieben, Klären und Projektstatus
- **Wischen zum Löschen**: Karte nach links wischen → „Löschen“ (endgültig, ohne Rückgängig). Aufgaben eines gelöschten Projekts bleiben als Einzelaufgaben.
- **Spracheingabe**: vorerst ausgeschaltet (Code bleibt, für spätere Versionen)
- **Karten-Design** in Solarized, Hell/Dunkel/System umschaltbar
- **Sync** über ein privates GitHub-Repository, Ende-zu-Ende verschlüsselt
- **Zurück auf früheren Stand**: Einstellungen → Stand vor einem Update, Ende eines Tages oder eigener Zeitpunkt. Nichts wird gelöscht, die App gleicht mit neuen Änderungen aus; lässt sich selbst wieder rückgängig machen.
- **Verschlüsseltes Backup** als Datei
- **Update-Hinweis**: Neue Versionen werden beim Öffnen erkannt und auf Knopfdruck installiert

## Sicherheit

| Was | Wo | Schutz |
|---|---|---|
| Aufgaben, Projekte | Gerät (IndexedDB) | bleibt lokal |
| Sync-Daten | privates Repo `head-space-data` | AES-256-GCM, Schlüssel aus Passphrase (PBKDF2-SHA256, 600'000 Runden) |
| Sync-Schlüssel | Gerät | als nicht exportierbarer Schlüssel gespeichert |
| GitHub-Token | nur auf dem Gerät | Fine-grained Token, nur für `head-space-data`, nur „Contents“ |
| App-Code | öffentliches Repo `head-space` | enthält keine Daten |

Die App lädt keinen fremden Code (keine Abhängigkeiten) und erlaubt per Content-Security-Policy nur Verbindungen zu sich selbst und zu `api.github.com`.

## Sync einrichten

1. **Token erstellen** auf github.com: Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
   - Repository access: *Only select repositories* → `head-space-data`
   - Permissions → Repository permissions → **Contents: Read and write**
2. In der App: **Einstellungen → Synchronisation über GitHub**: Benutzername, Repository, Token
3. **Erstes Gerät**: Sync-Passphrase festlegen (gut aufbewahren). **Weitere Geräte**: dieselbe Passphrase eingeben.

## Entwicklung

```bash
bun run build.mjs   # baut dist/ und preview/kopf-frei.html
bun test            # Unit-Tests (Logik, Daten, Kompatibilität, Verschlüsselung, Sync, Sprache)
tests/run.sh        # alles: Typen, Unit-Tests, End-to-End-Tests (Playwright + Chromium, parallel)
tests/run.sh 3 10   # Typen, Unit-Tests und nur die End-to-End-Tests 3 und 10 (GitHub prüft immer alles)
```

Jeder Push wird zuerst vollständig getestet und nur bei Erfolg veröffentlicht (GitHub Actions → GitHub Pages):
Branch `test` → Test-App, Branch `main` → Live-App. `scripts/build-site.sh` baut beide zusammen (Live nach `site/`, Test nach `site/test/`).
Geöffnete Apps zeigen danach „Neue Version verfügbar“.

### Regeln für Erweiterungen (Rückwärtskompatibilität)

Die Daten sind ein **Ereignis-Log**: Jede Änderung ist ein Ereignis, der Zustand entsteht durch Abspielen. Damit bestehende Daten bei jedem Update weiter funktionieren:

1. Ereignisse werden **nie geändert oder gelöscht**, nur neue angehängt.
2. Neue Felder sind **immer optional**. Standardwerte für fehlende Felder in `normalizeItem` / `normalizeProject` (`src/store.ts`).
3. Felder werden **nie umbenannt** oder umgedeutet. Stattdessen ein neues Feld einführen.
4. **Unbekannte Felder und Ereignistypen bleiben erhalten**, damit ältere App-Versionen auf anderen Geräten nichts kaputt machen.
5. Datenbank-Upgrades (`DB_VERSION` in `src/db.ts`) sind **nur additiv**: neue Speicher anlegen, nie löschen.
6. Das Sync-Format (`kopf-frei.json`, `events/*.json`) hat eine Versionsnummer. Eine ältere App lehnt neuere Formate ab, statt sie falsch zu lesen.
7. Für jede Erweiterung einen Test mit **Altdaten** ergänzen (siehe `tests/4-sync-kompatibilitaet-update.mjs`).

### Aufbau

```
src/
  types.ts    Datenmodell (Eintrag, Projekt, Ereignis)
  db.ts       IndexedDB, additive Migrationen
  store.ts    Ereignis-Log → Zustand, Aktionen, Backup, Kompatibilitätsregeln
  sync.ts     Verschlüsselter GitHub-Sync
  crypto.ts   Verschlüsselung (Web Crypto API)
  voice.ts    Spracheingabe (offline bevorzugt)
  icons.ts    Kontext-Symbole
  ui.ts       Ansichten, Dialoge, Einstellungen
  main.ts     Start, Service Worker, Update-Hinweis
  styles.css, cards.css   Gestaltung
public/       Manifest, Service Worker, Icons
tests/        End-to-End-Tests (Playwright)
.github/workflows/veroeffentlichen.yml   Build und Veröffentlichung
```
