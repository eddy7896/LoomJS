# 31 — Calendar and chat

Two elements that are each a small application, and both of which every project eventually asks for.

## Calendar

A month, with the rows falling on the days they belong to.

- **Rows in, days out.** `items` is bound to a query the same way a List's is; one property names the
  column holding the date, another the column holding the title.
- **The dates are read, not parsed cleverly.** `YYYY-MM-DD` and full ISO timestamps both work,
  because those are what a date column and a timestamp column actually hold. Anything else is
  skipped rather than guessed at — a row landing on the wrong day is worse than a row not showing.
- **The month is state**, so previous and next are real buttons rather than a link that reloads.
- **Shapes:** `month` is the grid; `agenda` is the same events as a list, which is what a phone
  wants and what a screen reader reads without a fight.
- **Weeks start on Monday or Sunday**, because both are correct and which one depends on where you
  are.

The grid is built from arithmetic on a `Date`, with no library. Working out which day a month starts
on is four lines; a date library is two hundred kilobytes and a lifetime of upgrades.

## Chat

A list of messages and a box to write one.

- **The messages are rows.** Bound to a query, with columns named for the text, the author and the
  time — so "chat" is a *shape*, not a separate storage system. It works over any connector loom
  already has.
- **Sending is an action sequence**, exactly like a button's. The composer holds its text in the
  usual field state, so a "save row" step reads it the same way it reads any other input.
- **Your own messages sit on the right.** That needs to know who you are, which the project already
  knows when it signs people in; without sign-in, every message is somebody else's, which is honest
  for a public feed.

### About "realtime"

New messages arrive by **asking again on a timer**, not over a websocket, and the element says so:
`Refresh every` is a number of seconds a designer sets, and zero means never.

That is a real decision, not a shortcut:

- The app's data goes through **server routes**, so the database credentials stay on the server. A
  websocket subscription from the browser needs a key *in* the browser. Supabase has one meant for
  that — the publishable key — but wiring it up means the browser talking to the database directly,
  which is a different security model than the one everything else here follows. It is worth doing
  deliberately, once, rather than smuggling it in behind a chat element.
- Polling every few seconds is what most chats of this size do anyway, and it fails softly: a missed
  request means the next one catches up.

So the label on the tin is "refreshes every N seconds", and anyone who needs sub-second delivery
owns the code and can add a subscription.

## What is deliberately not here

- **No typing indicators, no read receipts, no presence.** Each needs a channel that outlives a
  request, which is the same websocket conversation as above.
- **No infinite scroll of history.** The query decides how many messages arrive; a `limit` is a
  thing the query node already has.
- **No calendar editing by dragging.** Moving an event means writing to the row it came from, and
  the honest way to say that today is a form.
