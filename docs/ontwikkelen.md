# Ontwikkelen

Deze repo heeft één gedeelde basis voor codekwaliteit en tests. Alles wordt vanuit de **hoofdmap** geïnstalleerd en gestart.

## Eenmalig

1. Installeer **Node.js 24** (LTS):
   - Windows: `winget install OpenJS.NodeJS.LTS`
   - Mac: `brew install node@24`
2. Controleer: `node --version` moet `v24.x` geven.
3. Installeer alles, in de hoofdmap van de repo:
   ```bash
   npm install
   ```

Installeer nooit in een submap (`app/`, `backend/`). Er is één `package-lock.json` voor de hele repo.

## Commando's

| Commando | Wat het doet |
| --- | --- |
| `npm run check` | Alles wat de CI ook doet: lint, API-controle en tests. **Draai dit vóór je pull request.** |
| `npm run lint` | ESLint op alle code |
| `npm run lint:fix` | ESLint en lost wat kan automatisch op |
| `npm run lint:api` | Controleert of `docs/api.yaml` een geldige OpenAPI-specificatie is |
| `npm test` | Alle tests (contracttests + tests van app, backend en portal) |
| `npm run test:watch` | Tests opnieuw draaien bij elke wijziging |
| `npm run mock` | Start de mock-server op http://localhost:4010 |

## Mock-server

Met de mock-server kun je schermen bouwen voordat de echte backend klaar is. Hij geeft voor elk endpoint uit `docs/api.yaml` een voorbeeldantwoord.

```bash
npm run mock
```

- Endpoints waarvoor je moet inloggen geven `401` zonder header `Authorization: Bearer <iets>`. Elke waarde werkt, bijvoorbeeld `Bearer test`.
- Verplichte velden, lengtes en patronen in de request body worden gecontroleerd (`400`).
- Foutschermen testen: stuur de header `Prefer: code=429` (of een andere code die bij het endpoint staat).
- Hij luistert alleen op je eigen computer en accepteert alleen aanroepen vanaf `localhost`, zoals de Vite-dev-server.
- Geen WebSockets en geen echte opslag; dat doet de echte backend.

In de app gebruik je een omgevingsvariabele voor het adres, zodat je makkelijk wisselt tussen mock en echte backend. Zet in `app/.env.local`:

```
VITE_API_URL=http://localhost:4010
```

## Contracttests

`tests/api-contract.test.js` controleert de security-afspraken in `docs/api.yaml`, bijvoorbeeld:

- alleen de afgesproken endpoints zijn bereikbaar zonder inloggen;
- elk beveiligd endpoint geeft `401`, elk beheer-endpoint `403`;
- login, vriendcodes en SOS hebben rate limiting (`429`);
- ID's in URL's zijn UUID's, wachtwoorden hebben een minimale en maximale lengte.

Faalt zo'n test na een wijziging aan de API, overleg dan met Gijs (Cyber Security) in plaats van de test aan te passen.

## Je eigen project toevoegen

`app/`, `backend/` en `portal/` zijn npm-workspaces. Zodra er een `package.json` in staat, hoort het project bij de repo.

### App (Niek): Vite + React + PWA

```bash
npm create vite@latest app -- --template react-ts
```

Kies bij "Current directory is not empty" voor **Ignore files and continue**. Daarna:

1. **Verwijder** `app/eslint.config.js`; de gedeelde config in de hoofdmap geldt ook voor de app.
2. Haal in `app/package.json` de ESLint-packages en het script `lint` weg, en zet `"name": "@festivalapp/app"`.
3. Laat `app/tsconfig.app.json` beginnen met `"extends": "../tsconfig.base.json"`.
4. Voeg `vite-plugin-pwa` toe, vanuit de hoofdmap:
   ```bash
   npm install vite-plugin-pwa --workspace app --save-dev
   ```
5. Maak `app/vitest.config.ts` voor de tests van de app:
   ```ts
   import { defineConfig, mergeConfig } from 'vitest/config';
   import viteConfig from './vite.config';

   export default mergeConfig(viteConfig, defineConfig({
     test: { name: 'app', include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom' },
   }));
   ```
   Installeer daarvoor `jsdom`: `npm install jsdom --workspace app --save-dev`.

### Backend (Bob): Node.js + TypeScript

1. Maak `backend/package.json`:
   ```json
   {
     "name": "@festivalapp/backend",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "node --watch src/index.ts",
       "start": "node src/index.ts"
     }
   }
   ```
   Node 24 kan TypeScript direct uitvoeren, dus je hebt geen aparte build-stap nodig voor het ontwikkelen.
2. Maak `backend/tsconfig.json`:
   ```json
   {
     "extends": "../tsconfig.base.json",
     "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext", "noEmit": true, "allowImportingTsExtensions": true, "erasableSyntaxOnly": true },
     "include": ["src"]
   }
   ```
3. Maak `backend/vitest.config.ts`:
   ```ts
   import { defineConfig } from 'vitest/config';
   export default defineConfig({ test: { name: 'backend', include: ['src/**/*.test.ts'], environment: 'node' } });
   ```
4. Packages installeer je vanuit de hoofdmap: `npm install ws pg --workspace backend`.

## Security-regels in ESLint

Naast de standaardregels blokkeert ESLint een paar dingen die tot lekken kunnen leiden:

- `eval`, `new Function` en vergelijkbare constructies (code uitvoeren vanuit tekst);
- in de app en het portal: `innerHTML`, `outerHTML` en `dangerouslySetInnerHTML` (XSS).

Is een uitzondering echt nodig, overleg dan met Gijs en zet de reden in een commentaar bij `// eslint-disable-next-line`.

## Bekende meldingen

`npm audit` toont matige meldingen in `minimatch`, via ESLint en typescript-eslint. Dat raakt alleen het linten van onze eigen bestanden, niet de app. Dependabot werkt ze bij zodra er een nieuwe versie is.