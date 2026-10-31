# Link previews (Open Graph) and filling in HTML on the server

**In one sentence:** when someone pastes a public chat's link into Slack or X, the card that appears comes from `<meta property="og:…">` tags the server writes into `index.html` itself, because the bots that build those cards never run our JavaScript (`apps/server/src/http/spa.ts`, `apps/server/src/chats/preview.ts`).

## Why React can't do this

You may know `react-helmet` or setting `document.title` in an effect. That works for a browser tab, because the browser runs the app first. Slack's, X's, LinkedIn's and iMessage's bots don't: they download the HTML, read the `<head>`, and stop. Our `index.html` is the same empty shell for every URL, so without help every shared link would look identical.

So for `/c/:owner/:repo/:number` the server reads `index.html`, and before sending it puts a few tags just before `</head>`:

```html
<meta property="og:title" content="Cursor pagination · acme/api#12">
<meta property="og:description" content="3 points · 2 rounds · ready to approve">
<meta property="og:url" content="https://nitpilot.dev/c/acme/api/12">
<meta name="twitter:card" content="summary">
```

That's the Open Graph protocol: a list of agreed tag names every big site reads. The React app then starts as usual; it ignores the tags.

## Escaping: the part that matters for security

A PR title is text anyone can write. A title like `"><script>steal()</script>` pasted straight into `content="…"` would close the attribute and add a script to our page. In React, `{title}` in JSX is escaped for you; here we build HTML as a string, so we do it ourselves: `escapeHtml` turns `& < > " '` into `&amp; &lt; &gt; &quot; &#39;`. Every value goes through it. (Our Content-Security-Policy would also block an inline script, but escaping means nothing gets that far.)

## Only public chats get a card

The card is built only when the no-sign-in route (`GET /api/public/chats/...`) would show the chat: the same `publicChatAccessByPath` check, and the same 5-minute "is this repo public?" cache (made once in `createApp`). A private repo, `public_chats: false`, or a chat that doesn't exist gets the plain page, so the page never reveals a title the API would hide.

## `noindex`

Every `/c/...` page, public or not, says `<meta name="robots" content="noindex">` and sends an `X-Robots-Tag: noindex` header. Sharing a link is fine; Google listing every chat isn't what anyone signed up for.

## No image (yet)

The card is text only (`twitter:card` = `summary`). An `og:image` per chat would need generating a picture on the server; there's a `shortcut:` comment in `spa.ts` for when shares look bare.
