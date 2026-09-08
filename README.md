# Jahresabstimmung

Statische Abstimmungsseite (HTML/CSS/JS) mit Supabase als zentralem Speicher
und Admin-Login – fertig für GitHub Pages.

## Dateien

- `index.html` – Seite (öffentliche Ansicht + versteckter, passwortgeschützter Adminbereich)
- `style.css` – Design
- `app.js` – gesamte Logik (Daten + Login über Supabase)
- `config.js` – deine Supabase-Zugangsdaten (URL + anon key)
- `supabase.sql` – einmalig in Supabase auszuführendes Datenbank-Setup
- `favicon.svg` – Favicon

## 1. Supabase-Projekt einrichten

1. Auf [supabase.com](https://supabase.com) kostenlos ein Projekt anlegen.
2. Im Projekt unter **SQL Editor** eine neue Query öffnen, den kompletten Inhalt von
   `supabase.sql` einfügen und ausführen. Das legt an:
   - Tabellen `entries` (Klasse, Note) und `votes` (Stimmenzähler)
   - Funktionen zum sicheren Hochzählen/Zurücksetzen der Stimmen
   - Zugriffsregeln (RLS): Lesen und Abstimmen sind öffentlich, **Felder anlegen/löschen
     und Zurücksetzen ist nur für eingeloggte Admins erlaubt**
3. Unter **Project Settings → API** die **Project URL** und den **anon public key**
   kopieren und in `config.js` eintragen:

   ```js
   const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```

## 2. Admin-Account anlegen

1. Im Supabase-Dashboard unter **Authentication → Users** auf **Add user** klicken
   und eine E-Mail-Adresse + ein Passwort für dich vergeben (z. B. deine eigene E-Mail).
   „Auto Confirm User" aktivieren, damit kein Bestätigungslink nötig ist.
2. Unter **Authentication → Providers → Email** die Option **„Allow new users to sign up"**
   deaktivieren. Es gibt zwar keine Registrierungs-Oberfläche auf der Seite, aber so ist
   auch über die Supabase-API kein Selbst-Anlegen weiterer Accounts möglich.

Du kannst hier beliebig viele Admin-Accounts anlegen, falls mehrere Personen Zugriff
brauchen sollen.

## 3. Auf GitHub veröffentlichen

1. Repository anlegen, alle Dateien (inkl. ausgefüllter `config.js`) hineinlegen und pushen.
2. In den Repo-Einstellungen unter „Pages" den Branch aktivieren.
3. Die Seite läuft unter `https://<user>.github.io/<repo>/`.

## Benutzung

- **Öffentliche Seite** (`index.html`): zeigt alle Felder (Klasse + Note) mit einem
  „Abstimmen"-Button. Jedes Feld kann pro Browser genau einmal angeklickt werden,
  danach steht dort „Abgestimmt ✓". Stimmenanzahlen werden hier nirgends angezeigt.
  Dafür ist kein Login nötig.
- **Adminbereich**: erreichbar über `index.html#adminpage` – bewusst nirgends verlinkt.
  Beim Aufruf erscheint zunächst ein Login (E-Mail + Passwort). Erst danach sind
  Felder anlegen/löschen, die Statistik (live aktualisiert) und „Alle Stimmen
  zurücksetzen" sichtbar.

## Warum das jetzt wirklich abgesichert ist

Anders als vorher prüft nicht nur die Oberfläche, ob man „eingeloggt aussieht" –
die Datenbank selbst (Row Level Security in `supabase.sql`) lässt das Anlegen/Löschen
von Feldern und das Zurücksetzen der Stimmen **nur mit gültiger Admin-Anmeldung** zu.
Jemand, der die geheime `#adminpage`-Adresse errät, kommt zwar auf den Login-Bildschirm,
kann aber ohne die Zugangsdaten nichts verändern. Voten bleibt bewusst ohne Login möglich,
damit es für Abstimmende so einfach wie vorher ist.
