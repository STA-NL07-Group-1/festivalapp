// Code of conduct en privacy policy. Gelden voor de hele app, niet per festival.
// Houd de privacy policy gelijk met wat de app echt doet (zie backend/db/README.md).
// Let op: dit is een schoolproject. De teksten zijn een eerste versie en niet juridisch gecontroleerd.
import type { Locale } from '../lib/format'

export interface LegalSection {
  title: string
  paragraphs: string[]
}

export interface LegalText {
  title: string
  updated: string
  sections: LegalSection[]
}

const UPDATED = '2026-11-11'

const codeOfConduct: Record<Locale, LegalText> = {
  nl: {
    title: 'Code of conduct',
    updated: UPDATED,
    sections: [
      {
        title: 'Waar deze regels voor zijn',
        paragraphs: [
          'Deze app is er om samen een goed festival te hebben. Deze regels gelden voor alles wat je in de app doet: chatten, pins plaatsen, je naam en je locatie delen. Op het terrein gelden daarnaast de huisregels van het festival zelf.',
        ],
      },
      {
        title: 'Zo gaan we met elkaar om',
        paragraphs: [
          'Behandel anderen met respect. Geen intimidatie, bedreigingen, discriminatie of ongewenste seksuele berichten.',
          'Deel geen gegevens of foto’s van anderen zonder dat ze het goed vinden.',
          'Gebruik geen naam die beledigend is of die zich voordoet als iemand anders, zoals de organisatie.',
          'Volg altijd de aanwijzingen van beveiliging, EHBO en de organisatie.',
        ],
      },
      {
        title: 'SOS-knop',
        paragraphs: [
          'Gebruik de SOS-knop alleen als jij of iemand anders echt hulp nodig heeft. EHBO en beveiliging komen dan naar je locatie. Een valse melding kost hulp die ergens anders nodig is.',
          'Bij levensgevaar bel je altijd eerst 112.',
        ],
      },
      {
        title: 'Als iemand zich niet aan de regels houdt',
        paragraphs: [
          'Meld het bij de infobalie, bij beveiliging of met de SOS-knop als het dringend is.',
          'De organisatie kan een account blokkeren voor één festival. Bij ernstige gevallen, zoals mensen in gevaar brengen, kan een account voor alle festivals die deze app gebruiken worden geblokkeerd.',
        ],
      },
    ],
  },
  en: {
    title: 'Code of conduct',
    updated: UPDATED,
    sections: [
      {
        title: 'What these rules are for',
        paragraphs: [
          'This app is here so everyone can have a good festival. These rules apply to everything you do in the app: chatting, placing pins, sharing your name and your location. On site, the festival’s own house rules apply as well.',
        ],
      },
      {
        title: 'How we treat each other',
        paragraphs: [
          'Treat others with respect. No harassment, threats, discrimination or unwanted sexual messages.',
          'Do not share other people’s details or photos without their permission.',
          'Do not use a name that is offensive or pretends to be someone else, such as the organisers.',
          'Always follow instructions from security, first aid and the organisers.',
        ],
      },
      {
        title: 'SOS button',
        paragraphs: [
          'Only use the SOS button when you or someone else really needs help. First aid and security will come to your location. A false alarm takes help away from someone who needs it.',
          'If a life is in danger, always call 112 first.',
        ],
      },
      {
        title: 'If someone breaks the rules',
        paragraphs: [
          'Report it at the info desk, to security, or with the SOS button if it is urgent.',
          'The organisers can block an account for one festival. In serious cases, such as putting people in danger, an account can be blocked for all festivals that use this app.',
        ],
      },
    ],
  },
}

const privacyPolicy: Record<Locale, LegalText> = {
  nl: {
    title: 'Privacy policy',
    updated: UPDATED,
    sections: [
      {
        title: 'Over deze app',
        paragraphs: [
          'Festival Buddy is een schoolproject van studenten van Fontys Hogeschool ICT. De festivals in de app zijn verzonnen. Hieronder staat welke gegevens de app gebruikt, waarvoor en hoe lang.',
        ],
      },
      {
        title: 'Welke gegevens we opslaan',
        paragraphs: [
          'Account: je e-mailadres, je naam voor vrienden en je wachtwoord. Je wachtwoord slaan we alleen versleuteld op (als hash); niemand kan het teruglezen.',
          'Tickets: welke tickets aan je account hangen en voor welk festival. De ticketcode zelf slaan we alleen versleuteld op.',
          'Vrienden, berichten en pins: met wie je bevriend bent, je chats en de punten die je op de kaart zet.',
          'Je instellingen, zoals thema, taal en of je je locatie en timetable deelt.',
        ],
      },
      {
        title: 'Je locatie',
        paragraphs: [
          'Alleen als je "Locatie delen" aanzet, stuurt de app je locatie naar de server. Je vrienden zien die alleen als jullie op hetzelfde festival zijn.',
          'De server bewaart alleen je laatste locatie, en die verdwijnt na 10 minuten vanzelf. Zet je delen uit, dan wissen we hem meteen.',
          'Druk je op de SOS-knop, dan zien EHBO, beveiliging en de organisatie van dat festival je locatie, ook als je delen met vrienden uit hebt staat.',
          'Op je eigen telefoon bewaart de app de laatst bekende plek van jezelf en je vrienden, zodat de kaart ook zonder internet werkt. Dat wordt gewist als je uitlogt.',
        ],
      },
      {
        title: 'Wie je gegevens ziet',
        paragraphs: [
          'Je vrienden zien je naam, en alleen als je dat aanzet je locatie en je timetable.',
          'De organisatie van een festival ziet de naam en het e-mailadres van bezoekers met een ticket voor dát festival, zodat ze bijvoorbeeld een ticket VIP kunnen maken of iemand kunnen blokkeren. Berichten tussen vrienden kan de organisatie niet lezen.',
          'We verkopen geen gegevens en gebruiken ze niet voor reclame.',
        ],
      },
      {
        title: 'Hoe lang we gegevens bewaren',
        paragraphs: [
          'Je account, vrienden en chats blijven bewaard zolang je account bestaat, ook na een festival. Zo kun je bij een volgend festival je vrienden en oude berichten nog terugvinden.',
          'Na afloop van een festival kun je niet meer bij de kaart, timetable en meldingen van dat festival.',
          'Voor de veiligheid houden we een logboek bij van belangrijke acties, zoals inloggen en blokkeren. Daar staan geen berichten of locaties in.',
        ],
      },
      {
        title: 'Je rechten',
        paragraphs: [
          'Je kunt je naam en instellingen zelf aanpassen bij Account en Instellingen.',
          'Bij Account kun je je account verwijderen. Je account, vrienden, pins, berichten en locatie worden dan meteen gewist. Je ticket komt weer vrij.',
          'Vragen over je gegevens? Neem contact op met het projectteam (Fontys, STA-NL07 groep 1).',
        ],
      },
    ],
  },
  en: {
    title: 'Privacy policy',
    updated: UPDATED,
    sections: [
      {
        title: 'About this app',
        paragraphs: [
          'Festival Buddy is a school project by students of Fontys University of Applied Sciences ICT. The festivals in the app are made up. Below is which data the app uses, what for and for how long.',
        ],
      },
      {
        title: 'What we store',
        paragraphs: [
          'Account: your email address, your name for friends and your password. We only store your password encrypted (as a hash); nobody can read it back.',
          'Tickets: which tickets are linked to your account and for which festival. The ticket code itself is only stored encrypted.',
          'Friends, messages and pins: who you are friends with, your chats and the points you place on the map.',
          'Your settings, such as theme, language and whether you share your location and timetable.',
        ],
      },
      {
        title: 'Your location',
        paragraphs: [
          'Only when you turn on "Share location" does the app send your location to the server. Your friends only see it when you are at the same festival.',
          'The server only keeps your last location, and it disappears by itself after 10 minutes. If you turn sharing off, we delete it straight away.',
          'If you press the SOS button, first aid, security and the organisers of that festival see your location, even if sharing with friends is off.',
          'On your own phone the app keeps the last known position of you and your friends, so the map works without internet. This is deleted when you log out.',
        ],
      },
      {
        title: 'Who sees your data',
        paragraphs: [
          'Your friends see your name, and only if you turn it on your location and your timetable.',
          'The organisers of a festival see the name and email address of visitors with a ticket for that festival, so they can for example make a ticket VIP or block someone. The organisers cannot read messages between friends.',
          'We do not sell data or use it for advertising.',
        ],
      },
      {
        title: 'How long we keep data',
        paragraphs: [
          'Your account, friends and chats are kept as long as your account exists, also after a festival. That way you can still find your friends and old messages at the next festival.',
          'After a festival has ended you can no longer open that festival’s map, timetable and news.',
          'For security we keep a log of important actions, such as logging in and blocking. It contains no messages or locations.',
        ],
      },
      {
        title: 'Your rights',
        paragraphs: [
          'You can change your name and settings yourself under Account and Settings.',
          'Under Account you can delete your account. Your account, friends, pins, messages and location are deleted immediately. Your ticket becomes available again.',
          'Questions about your data? Contact the project team (Fontys, STA-NL07 group 1).',
        ],
      },
    ],
  },
}

export const LEGAL = { codeOfConduct, privacyPolicy }
