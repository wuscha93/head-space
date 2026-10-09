# Hinweise für Claude

Persönliche GTD-App „Kopf frei“ des Nutzers (wuscha93). Sprache: Deutsch (Schweiz, „ss“ statt „ß“ in UI-Texten).

## Vor jeder Änderung
- README-Abschnitt „Regeln für Erweiterungen“ einhalten. Der Nutzer arbeitet mit echten Daten weiter; **jede Änderung muss alte Daten lesen können**.
- Neue Felder: optional + Standardwert in `normalizeItem`/`normalizeProject`. Nie Felder umbenennen, nie Ereignisse ändern.
- `DB_VERSION` nur erhöhen für neue Object Stores (additiv).
- Keine externen Abhängigkeiten zur Laufzeit; CSP in `build.mjs` nicht lockern.

## Tests (Pflicht)
- Jede Funktion hat **Unit-Tests** (`tests/unit/*.test.ts`, `bun test`) für die Logik und, wo es um Bedienung geht, **End-to-End-Tests** (`tests/[0-9]-*.mjs`, Playwright).
- Neue oder geänderte Funktion → zuerst Test schreiben, der ohne die Änderung fehlschlägt.
- Bedienung auf dem Handy mit **echten Touch-Ereignissen** testen (`tap()`, `hasTouch: true`), nicht nur mit Mausklicks.
- Logik gehört in `src/logic.ts`, `store.ts`, `sync.ts` usw., nicht in `ui.ts`, damit sie ohne Browser testbar ist.
- GitHub Actions führt alle Tests vor dem Veröffentlichen aus; schlägt einer fehl, wird nichts veröffentlicht.

## Ablauf
1. Ändern, dann `tests/run.sh` (Typen + Unit + End-to-End; alle müssen bestehen).
2. Version in `package.json` erhöhen (Patch für Korrekturen, Minor für Funktionen).
3. Commit auf `main` und pushen → GitHub Actions veröffentlicht automatisch auf https://wuscha93.github.io/head-space/.
4. Die installierte App zeigt danach „Neue Version verfügbar“.

## Nie
- Nutzerdaten, Tokens oder Passphrasen ins Repo oder in Logs.
- Das Daten-Repo `head-space-data` anfassen (gehört nur der App).
