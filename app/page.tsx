import Link from "next/link";
import { ButtonLink } from "@/components/ui";

const STEPS = [
  { title: "Talk for five minutes", body: "Tell Munshi about your shop in Kannada, Hindi, Tamil or English. It asks one question at a time." },
  { title: "Approve your store", body: "Munshi builds your store page and product list. Nothing goes public until you tap Approve." },
  { title: "Take orders anywhere", body: "Buyers order from your link or by phone. You get an alert and tap Accept." },
];

export default function Landing() {
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-8">
      <div className="signboard px-6 py-7">
        <p className="font-display text-lg font-bold text-ink/80">ಮುನ್ಷಿ · मुंशी · முன்ஷி</p>
        <h1 className="mt-1 font-display text-5xl font-extrabold text-ink">Munshi</h1>
        <p className="mt-3 text-[17px] leading-snug text-ink">
          Your shop&apos;s helper. Talk to it, and it runs your shop online.
        </p>
      </div>

      <p className="mt-8 text-[17px] leading-relaxed text-ink-soft">
        Most neighbourhood buyers will never browse a website. They call or send a WhatsApp. Munshi answers them,
        builds the order for cash on delivery, and asks you only to approve.
      </p>

      <ol className="mt-8 space-y-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-lg font-bold">
              {i + 1}
            </span>
            <div>
              <h2 className="font-display text-xl font-bold">{s.title}</h2>
              <p className="mt-0.5 text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <ButtonLink href="/start" tone="leaf" className="mt-10 w-full py-4 text-lg">
        Start my shop
      </ButtonLink>
      <p className="mt-4 text-center text-sm text-mute">
        Already set up? <Link href="/start" className="font-semibold text-ink underline">Sign in with your phone</Link>
      </p>
    </main>
  );
}
