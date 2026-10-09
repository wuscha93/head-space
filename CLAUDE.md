# Hinweise für Claude

Persönliche GTD-App „Kopf frei“ des Nutzers (wuscha93). Sprache: Deutsch (Schweiz, „ss“ statt „ß“ in UI-Texten).

## Vor jeder Änderung
- README-Abschnitt „Regeln für Erweiterungen“ einhalten. Der Nutzer arbeitet mit echten Daten weiter; **jede Änderung muss alte Daten lesen können**.
- Neue Felder: optional + Standardwert in `normalizeItem`/`normalizeProject`. Nie Felder umbenennen, nie Ereignisse ändern.
- `DB_VERSION` nur erhöhen für neue Object Stores (additiv).
- Keine externen Abhängigkeiten zur Laufzeit; CSP in `build.mjs` nicht lockern.

## Ablauf
1. Ändern, `tsc -p .` und `tests/run.sh` (alle Tests müssen bestehen; für neue Funktionen Tests ergänzen).
2. Version in `package.json` erhöhen (Patch für Korrekturen, Minor für Funktionen).
3. Commit auf `main` und pushen → GitHub Actions veröffentlicht automatisch auf https://wuscha93.github.io/head-space/.
4. Die installierte App zeigt danach „Neue Version verfügbar“.

## Nie
- Nutzerdaten, Tokens oder Passphrasen ins Repo oder in Logs.
- Das Daten-Repo `head-space-data` anfassen (gehört nur der App).
