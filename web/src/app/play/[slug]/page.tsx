"use client";

import { useParams } from "next/navigation";
import { Checkout } from "@/games/shared/Checkout";

export default function PlayPage() {
  const { slug } = useParams<{ slug: string }>();
  return <Checkout slug={slug} />;
}
