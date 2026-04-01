import "@/styles/globals.css";
import { Manrope, Sora } from "next/font/google";
import Layout from "@/components/Layout";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
});

export default function App({ Component, pageProps }) {
  return (
    <main className={`${manrope.variable} ${sora.variable}`}>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </main>
  );
}