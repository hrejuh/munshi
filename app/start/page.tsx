import { redirect } from "next/navigation";
import { Page } from "@/components/ui";
import { currentShop } from "@/lib/session";
import { SignUpForm } from "./SignUpForm";

export default async function StartPage() {
  if (await currentShop()) redirect("/app");
  return (
    <Page>
      <h1 className="mb-6 font-display text-3xl font-extrabold">Start your shop</h1>
      <SignUpForm />
    </Page>
  );
}
