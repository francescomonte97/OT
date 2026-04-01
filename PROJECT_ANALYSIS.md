# Analisi dettagliata del progetto `BBT Motion`

## 1) Panoramica
`BBT Motion` è una web app front-end (solo client-side) progettata per supportare il **Box and Block Test** tramite i sensori di orientamento del dispositivo (DeviceOrientation). L’app:
- guida l’utente in un flusso a stati (abilitazione sensori → calibrazione → countdown → registrazione → salvataggio prova);
- campiona `beta`/`gamma`, calcola una velocità angolare derivata e varie metriche di performance;
- visualizza risultati in tempo reale e su 3 prove con grafici Canvas;
- confronta blocchi manuali inseriti dall’operatore con blocchi stimati da un modello euristico.

## 2) Stack e architettura
- **Runtime:** browser moderno, nessun backend.
- **Linguaggio:** JavaScript ES modules.
- **UI:** HTML + CSS custom (layout responsive).
- **Grafici:** rendering manuale su `<canvas>`.

### Struttura file
- `index.html`: UI completa (layout, card metriche, canvas grafici, pannello debug).
- `app.js`: orchestrazione applicazione, state machine, gestione sensori/timer/UI.
- `core/utils.js`: helper matematici/formatting.
- `core/audio.js`: beep di fine test via Web Audio API.
- `core/charts.js`: funzioni di disegno grafici.
- `metrics/bbtMetrics.js`: calcolo metriche prova e riepilogo multi-prova.

## 3) Flusso applicativo
L’app usa uno stato centrale (`state`) con fasi:
- `idle`
- `prep_calibration`
- `calibrating`
- `ready`
- `countdown`
- `recording`
- `await_blocks`
- `done`

Flusso tipico:
1. **Abilita sensori**: verifica secure context (`HTTPS`/localhost), supporto API e permessi.
2. **Calibra**: 1s preparazione + 2s acquisizione baseline (media di beta/gamma filtrati).
3. **Avvia test**: countdown 3s.
4. **Registrazione**: 60s di campionamento; calcolo live metriche.
5. **Fine registrazione**: beep e richiesta blocchi manuali.
6. **Salva prova**: salva trial, aggiorna riepilogo, passa alla prova successiva (max 3).

## 4) Pipeline dati sensore
Evento `deviceorientation`:
- legge `event.beta` e `event.gamma`;
- applica low-pass (`alpha=0.22`) su entrambi;
- calcola velocità angolare composita (norma di derivate beta/gamma) in °/s;
- smooth aggiuntivo velocità con `motionSpeedAlpha=0.35`;
- durante `recording`, salva sample `{t, beta, gamma, deltaBeta, deltaGamma, speed}`.

`deltaBeta`/`deltaGamma` sono rispetto alla baseline di calibrazione.

## 5) Metriche implementate
Nel modulo `metrics/bbtMetrics.js`:
- **Tempo totale / attivo / inattivo**
- **Activity ratio** (attivo/tempo totale)
- **Pause detection** (sotto soglia velocità con durata minima)
- **Burst detection** (sopra soglia velocità con durata minima)
- **Velocità media attiva / picco**
- **Workspace beta/gamma** (range angolare per asse)
- **Fatigue index** (velocità attiva 2ª metà / 1ª metà)
- **Smoothness score** (combinazione di penalità su pause, burst rate, variabilità burst)
- **Directional extrema** su asse dominante (beta o gamma) con smoothing
- **Estimated blocks** da modello euristico pesato:
  - burst,
  - cadenza,
  - estremi direzionali,
  - fattori di correzione su velocità/smoothness/tempo attivo.

Per la serie di 3 prove è calcolato un **summary** con medie e best-of.

## 6) Grafici disponibili
Su Canvas custom:
1. **Line chart** velocità nel tempo.
2. **Activity timeline** segmenti attivo/inattivo.
3. **Halves comparison** (1ª vs 2ª metà) su tempo attivo, velocità, pause.
4. **Workspace scatter** su piano Δβ–Δγ.
5. **Dual bar** blocchi manuali vs stimati.
6. **Bar chart** smoothness per prova.

Le funzioni gestiscono anche fallback “no data / dati insufficienti”.

## 7) Punti di forza
- Architettura modulare chiara (UI/orchestrazione vs metriche vs grafici).
- Flusso clinico ben guidato con stato esplicito.
- Metriche numerose e già utili per osservazione prestazionale.
- Rendering grafico indipendente da librerie esterne.
- Gestione permessi iOS/Safari (`requestPermission`) inclusa.

## 8) Limiti e rischi tecnici
1. **Solo front-end**: nessuna persistenza/export (CSV/JSON) al momento.
2. **Dipendenza dal dispositivo**: qualità sensoristica varia tra smartphone.
3. **Soglie statiche**: tuning non personalizzato per paziente/task.
4. **Algoritmo stima blocchi euristico**: utile ma non validato statisticamente qui.
5. **Assenza test automatici** (unit/integration).
6. **Nessun controllo anti-drift avanzato** oltre low-pass.
7. **UI hero incompleta**: nel blocco iniziale ci sono contenitori vuoti (probabile placeholder).

## 9) Miglioramenti consigliati (priorità)
### Alta priorità
- Aggiungere **export dati** prova/serie (CSV + JSON).
- Introdurre **configurazione soglie** da UI (preset clinici).
- Implementare **test unitari** per `computeBBTMetrics` con dataset sintetici.

### Media priorità
- Aggiungere **validazione qualità segnale** (es. rate campionamento minimo).
- Salvare sessioni in `localStorage`.
- Mostrare intervalli confidenza/variabilità per migliorare interpretabilità.

### Bassa priorità
- Rifinire contenuti hero (titolo, sottotitolo, pill informative).
- Migliorare accessibilità (ARIA live region per stato timer/fase).

## 10) Valutazione complessiva
Il progetto è già una buona base MVP per monitoraggio motorio nel contesto BBT: flusso d’uso coerente, calcolo metriche ricco, visualizzazione efficace e codice relativamente pulito. Per uso operativo/clinico reale servono soprattutto robustezza dati (persistenza, export, QA algoritmico) e validazione quantitativa delle stime.

## 11) Considerazioni specifiche: telefono fissato al braccio con elastico
Se il telefono è **indossato sul braccio** (invece che tenuto in mano o appoggiato), cambiano alcune assunzioni biomeccaniche:

- il segnale cattura molto bene movimenti di spalla/gomito, meno i micro-movimenti fini di mano/polso;
- aumenta il rischio di artefatti da **micro-slittamento** dell’elastico;
- la posizione esatta (avambraccio prossimale/distale, orientamento del telefono) influisce fortemente sulle ampiezze angolari;
- pazienti con compensi tronco-spalla possono “gonfiare” alcuni indici di attività senza reale miglioramento della destrezza fine.

Implicazione: le metriche correnti sono utili, ma vanno interpretate come indicatori di **qualità del gesto prossimale + ritmo globale**, non come misura pura della manipolazione fine.

## 12) Cosa aggiungerei (con priorità)
### A) Standardizzazione del posizionamento (priorità altissima)
- Checklist pre-test obbligatoria in UI:
  - lato testato;
  - punto di fissaggio (es. 1/3 distale avambraccio);
  - orientamento telefono (alto/basso, schermo verso esterno/interno);
  - tensione elastico (scala soggettiva 1–5).
- Salvataggio di questi metadati assieme alla prova.

Beneficio: confronti longitudinali più affidabili e meno variabilità non clinica.

### B) QC del segnale (“data quality gate”) prima del test (alta)
- Mini routine di 5–8 secondi pre-test:
  - verifica frequenza campionamento media;
  - rileva saturazioni/clipping;
  - stima rumore a riposo;
  - controlla drift baseline.
- Se quality score sotto soglia: warning esplicito e richiesta riposizionamento elastico.

Beneficio: riduce sessioni inutilizzabili.

### C) Nuove metriche più robuste al montaggio su braccio (alta)
- **Jerk proxy** (derivata della velocità) per fluidità motoria.
- **Rhythmicity index** (regolarità ciclica dei burst).
- **Symmetry/compensation index** opzionale combinando asse dominante e componente ortogonale.
- **Stability at rest** (varianza in finestre di pausa) per valutare controllo posturale durante il compito.

Beneficio: maggiore sensibilità a miglioramenti clinicamente rilevanti.

### D) Calibrazione multi-posa (media)
- Oltre alla baseline “fermo”, introdurre 2 pose guidate brevi:
  1) posizione neutra;
  2) flessione controllata.
- Usare queste pose per normalizzare range dinamico intra-soggetto.

Beneficio: confronti più equi tra pazienti e sessioni.

### E) Report clinico automatico (media)
- Export PDF/CSV con:
  - indicatori principali;
  - trend su prove/sessioni;
  - semafori interpretativi (“migliora”, “stabile”, “attenzione compensi”).

Beneficio: integrazione pratica nel workflow del terapista.

## 13) Cosa migliorerei nel codice attuale
1. **Separare modello metriche da UI state** in un modulo “pipeline” testabile (input samples + config -> output metrics).
2. **Introdurre configurazione versionata** delle soglie (`metricProfile v1`, `v2`) per tracciabilità clinica.
3. **Persistenza locale** delle prove (localStorage/IndexedDB) con schema JSON esplicito.
4. **Test automatici su dataset sintetici**:
   - test di regressione su `computeBBTMetrics`;
   - scenari rumorosi/slittamento elastico;
   - edge-case con pochi campioni o dt irregolare.
5. **Flag di affidabilità** per ogni metrica (high/medium/low confidence) in base alla qualità segnale.

## 14) Roadmap pratica in 3 sprint
### Sprint 1 (quick wins)
- Metadati posizionamento + checklist UI.
- Quality gate pre-test.
- Export CSV base.

### Sprint 2
- Nuovi indici (jerk/rhythmicity/stability at rest).
- Refactor pipeline metriche + primi test unitari.

### Sprint 3
- Report PDF clinico.
- Versioning profili soglia e confronto longitudinale multi-sessione.

## 15) Sintesi operativa
Con telefono fissato al braccio, il progetto è già molto promettente, ma la priorità è rendere i dati **comparabili e affidabili**: standardizzare il montaggio, misurare qualità segnale e introdurre metriche più robuste ai compensi. Dopo questi step, la piattaforma può diventare uno strumento clinico molto più solido per follow-up e decisioni terapeutiche.

## 16) A cosa servono le metriche (e dove possono essere ridondanti)
Di seguito una lettura pratica metrica-per-metrica per uso clinico.

### Metriche di intensità/quantità movimento
- **activeTimeMs / activityRatio**: quanto tempo il paziente è in movimento “utile” durante il test.
- **activeMeanSpeed / peakSpeed**: intensità media e picchi del gesto.

Uso: screening rapido su “quanto si muove”.

Possibile ridondanza:
- `activeTimeMs` e `activityRatio` sono fortemente correlati (stesso fenomeno, scala diversa).
- `activeMeanSpeed` e `peakSpeed` possono essere entrambi alti in prove molto frammentate: tenerli insieme è utile, ma uno dei due può bastare in report sintetici.

### Metriche di frammentazione/pausa
- **pauseCount / pauseLoad / meanPauseMs**: descrivono quante pause ci sono, quanto “pesano” e quanto durano.
- **burstCount / meanBurstMs / burstCv**: struttura dei segmenti attivi.

Uso: distinguere pattern fluidi vs stop-and-go.

Possibile ridondanza:
- `pauseLoad` e `idleTimeMs` raccontano quasi la stessa storia (tempo non attivo).
- `pauseCount` e `burstCount` possono crescere insieme in movimenti molto intermittenti.

### Metriche di qualità motoria globale
- **smoothnessScore**: indice composito (pause + burst rate + variabilità burst).
- **jerkProxy**: quanto rapidamente cambia l’accelerazione (movimento “scattoso”).
- **rhythmicityIndex**: regolarità temporale dei burst.
- **stabilityAtRest**: stabilità nei momenti di bassa velocità.
- **compensationIndex**: quanta componente “ortogonale” rispetto all’asse dominante viene usata (proxy compensi).

Uso: qualità del gesto e controllo motorio, soprattutto con telefono su avambraccio.

Possibile ridondanza:
- `smoothnessScore` e `jerkProxy` misurano concetti simili (fluidità), ma da prospettive diverse:
  - smoothness = composito macro;
  - jerk = micro-irregolarità.
- `smoothnessScore` e `rhythmicityIndex` possono correlare in task molto ciclici.
- `stabilityAtRest` può sovrapporsi parzialmente a `pauseLoad`, ma aggiunge informazione sulla “qualità” della pausa (stabile vs tremolante).

### Metriche di performance funzionale
- **blocksTransferred**: outcome clinico osservato (gold reference della prova).
- **estimatedBlocks**: stima da sensore.
- **fatigueIndex**: calo/incremento tra seconda e prima metà.

Uso: performance finale + andamento intra-prova.

Possibile ridondanza:
- `blocksTransferred` resta la metrica principale di outcome; `estimatedBlocks` è di supporto e non dovrebbe sostituirla.

## 17) Set minimo consigliato (anti-ridondanza)
Per dashboard snelle suggerisco:
1. **Outcome**: `blocksTransferred` (e opzionalmente `estimatedBlocks`).
2. **Dose movimento**: `activityRatio` (oppure `activeTimeMs`, non entrambi).
3. **Qualità**: `smoothnessScore` + `jerkProxy` (oppure `rhythmicityIndex` se task ciclico).
4. **Controllo**: `stabilityAtRest`.
5. **Compensi**: `compensationIndex`.
6. **Andamento**: `fatigueIndex`.

## 18) Regola pratica per evitare duplicati nel report clinico
- **Report breve (5-6 metriche)**: outcome + activityRatio + smoothness + jerk + compensation + fatigue.
- **Report esteso**: aggiungere pause/burst per interpretabilità meccanicistica.
- Se due metriche hanno correlazione molto alta in dati reali del centro (es. >0.85 su più sessioni), mantenerne una sola nel report standard e lasciare l’altra in “dettaglio tecnico”.
