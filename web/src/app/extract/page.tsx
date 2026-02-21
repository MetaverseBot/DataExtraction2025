import { redirect } from "next/navigation";

export default function ExtractPage() {
  redirect("/?panel=0");
}
