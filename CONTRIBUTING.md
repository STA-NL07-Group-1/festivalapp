# Bijdragen aan Festivalapp

Fijn dat je meewerkt! Hier staat hoe we samenwerken. Lees ook de [gedragscode](CODE_OF_CONDUCT.md).

## Eenmalig instellen

1. Clone de repo en kopieer `.env.example` naar `.env`. Zet nooit echte keys in de repo.
2. Zet de lokale secret-check aan:
   ```bash
   winget install Gitleaks.Gitleaks      # Mac: brew install gitleaks
   git config core.hooksPath .githooks
   ```
3. Onderteken je commits met een SSH-sleutel, zodat op GitHub bij elke commit **Verified** staat:
   ```powershell
   ssh-keygen -t ed25519 -C "jouw-github-email" -f "$HOME\.ssh\id_ed25519_signing"
   git config --global gpg.format ssh
   git config --global user.signingkey "$HOME/.ssh/id_ed25519_signing.pub"
   git config --global commit.gpgsign true
   git config --global tag.gpgsign true
   Get-Content "$HOME\.ssh\id_ed25519_signing.pub" | Set-Clipboard
   ```
   Ga op GitHub naar **Settings → SSH and GPG keys → New SSH key**, kies **Key type: Signing Key** en plak de sleutel.
   Je `git config user.email` moet hetzelfde zijn als een geverifieerd e-mailadres op je GitHub-account.

## Een taak oppakken

1. Kies een issue op het [projectbord](https://github.com/orgs/STA-NL07-Group-1/projects) en zet jezelf als **Assignee**.
2. Maak een branch met het issuenummer: `feature/12-accounts-login`, `fix/27-chat-laadt-niet`, `docs/34-api-afspraken` of `chore/40-dependencies`.
3. Commit kleine, duidelijke stappen en push je branch.
4. Open een pull request, zet `Closes #12` in de beschrijving en vul de checklist in.
5. Vraag een teamgenoot om een review.
6. Na goedkeuring en groene checks: **Squash and merge** en **Delete branch**.

## Eisen aan een pull request

- Minimaal **1 goedkeuring** van een teamgenoot; je eigen pull request goedkeuren kan niet.
- Alle checks slagen: TruffleHog, Semgrep, CodeQL en Dependency Review.
- Reviewopmerkingen zijn opgelost.
- **Nieuwe functionaliteit krijgt tests** in de automatische testsuite.
- Geen wachtwoorden, keys, tokens of persoonsgegevens in code, logs of screenshots.
- Wijzigingen aan de API worden ook bijgewerkt in [`docs/api.yaml`](docs/api.yaml).

## Bugs en ideeën

Gebruik de templates **Bug melden** of **Feature of taak** bij [nieuwe issues](https://github.com/STA-NL07-Group-1/festivalapp/issues/new/choose).

**Beveiligingsprobleem?** Maak geen openbaar issue aan, maar volg [SECURITY.md](SECURITY.md).