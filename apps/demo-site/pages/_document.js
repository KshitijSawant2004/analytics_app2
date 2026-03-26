import { Html, Head, Main, NextScript } from "next/document";

const ANALYTICS_PROJECT_ID =
  process.env.NEXT_PUBLIC_ANALYTICS_PROJECT_ID || "8b2b11d0-ad4f-4d90-b046-aacb789f2ba3";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Analytics tracking script - captures all events */}
        <script
          src="/analytics.js"
          data-project-id={ANALYTICS_PROJECT_ID}
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
