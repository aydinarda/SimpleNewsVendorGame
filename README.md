# Simple Newsvendor Game

EverChic Fashions senaryosu icin React + Vite frontend ve 3 endpointli Node.js backend.

## Yeni mimari

- Frontend sadece API cagirir.
- Demand uretimi backend'de yapilir.
- Profit hesaplama backend'de yapilir.
- Sonuclar backend'de oyuncu bazli saklanir (in-memory).
- Leaderboard backend'de hesaplanir.

## Endpointler

1. `POST /start-game`
2. `POST /submit-order`
3. `GET /leaderboard`

### 1) POST /start-game

Body:

```json
{
  "nickname": "mert",
  "adminKey": "admin123"
}
```

- `adminKey` verilirse aktif oyun olusturur (admin).
- `adminKey` yoksa mevcut aktif oyuna oyuncu olarak katilir.

### 2) POST /submit-order

Body:

```json
{
  "gameId": "...",
  "playerId": "...",
  "orderQuantity": 1200
}
```

- Demand backend'de random uretir.
- Profit backend'de hesaplar.
- Round sonucunu oyuncu gecmisine kaydeder.

### 3) GET /leaderboard

Query:

```text
/leaderboard?gameId=...
```

- Tum oyuncularin kümülatif profit'ini hesaplar.
- Sirali ve rank atanmis sonucu doner.

## Klasor yapisi

```text
server/
  index.js
  rounds.js
  utils/
    demand.js
    profit.js

src/
  components/
    RoundInfo.jsx
    OrderForm.jsx
    RoundResult.jsx
    Leaderboard.jsx
    ProgressBar.jsx
  utils/
    api.js
    demand.js
  App.jsx
  main.jsx
```

## Local calistirma

1. `npm install`
2. Backend: `npm run server`
3. Frontend: `npm run dev`

Frontend default olarak `http://localhost:4000` backend adresini kullanir.

## Ortam degiskenleri

Frontend (`.env`):

```bash
VITE_API_BASE_URL=http://localhost:4000
```

Backend:

```bash
ADMIN_KEY=admin123
PORT=4000
```

## Build

1. `npm run build`
2. `npm run preview`
