import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Analytics tracking script - captures all events */}
        <script
          src="/analytics.js"
          data-project-id="00000000-0000-0000-0000-000000000000"
          data-endpoint="http://localhost:4001/track"
          async
        />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
