# Hinweise für Claude

Persönliche GTD-App „Kopf frei“ des Nutzers (wuscha93). Sprache: Deutsch (Schweiz, „ss“ statt „ß“ in UI-Texten).

## Zusammenarbeit (Wunsch des Nutzers, gilt immer)
- **Nichts annehmen und umsetzen, ohne zu fragen.** Ist etwas unklar oder gibt es mehrere sinnvolle Lösungen
  (Gestaltung, Verhalten, Wortwahl, wo etwas gilt), zuerst nachfragen und auf die Antwort warten.
- Bei Gestaltungsfragen zuerst Vorschläge als Screenshots zeigen; umsetzen erst nach ausdrücklichem OK.
- Weicht die Umsetzung in einem Detail von dem ab, was der Nutzer gesehen oder gesagt hat, vorher fragen –
  nicht nachträglich erwähnen.

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

## Umgebungen
- **Live** = Branch `main` → https://wuscha93.github.io/head-space/ (echte Daten, Sync mit `head-space-data`)
- **Test** = Branch `test` → https://wuscha93.github.io/head-space/test/ (eigene Datenbank, Beispieldaten, **kein Sync**)
- Beide liegen auf derselben Domain. Alles, was im Browser gespeichert wird, ist über `src/env.ts` getrennt
  (Datenbankname, localStorage-Schlüssel, Cache-Präfix, Service-Worker-Bereich). Daran nichts ändern, ohne Test 6 zu erweitern.

## Ablauf
1. Ändern **auf Branch `test`**, dann `tests/run.sh` (Typen + Unit + End-to-End; alle müssen bestehen).
2. Version in `package.json` erhöhen (Patch für Korrekturen, Minor für Funktionen).
3. Commit und `git push origin test` → GitHub testet und veröffentlicht nur die **Test-App**.
4. Nutzer prüft in der Test-App. **Erst wenn er „freigeben“ schreibt:** `test` in `main` übernehmen
   (`git checkout main && git merge --ff-only test && git push origin main`) → Live-App zeigt „Neue Version verfügbar“.
   Geht `--ff-only` nicht (Korrektur direkt auf `main`), zuerst `main` in `test` mergen, dann vorspulen.
5. Nie direkt auf `main` entwickeln (Ausnahme: dringende Korrektur, die der Nutzer ausdrücklich live will).

## Nie
- Nutzerdaten, Tokens oder Passphrasen ins Repo oder in Logs.
- Das Daten-Repo `head-space-data` anfassen (gehört nur der App).
