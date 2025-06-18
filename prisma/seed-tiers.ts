// prisma/seed-tiers.ts
import prisma from "../app/db.server";

async function seedTiers() {
  console.log("Seeding tiers...");

  const tiers = [
    {
      name: "bronze",
      displayName: "Bronze",
      level: 1,
      minSpend: 0,
      spendingPeriodDays: 365,
      cashbackPercent: 1,
      color: "#CD7F32",
    },
    {
      name: "silver",
      displayName: "Silver",
      level: 2,
      minSpend: 500,
      spendingPeriodDays: 365,
      cashbackPercent: 2,
      color: "#C0C0C0",
    },
    {
      name: "gold",
      displayName: "Gold",
      level: 3,
      minSpend: 1500,
      spendingPeriodDays: 365,
      cashbackPercent: 3,
      color: "#FFD700",
    },
    {
      name: "platinum",
      displayName: "Platinum",
      level: 4,
      minSpend: 5000,
      spendingPeriodDays: 365,
      cashbackPercent: 5,
      color: "#E5E4E2",
    },
  ];

  for (const tier of tiers) {
    await prisma.tier.create({
      data: tier,
    });
    console.log(`Created tier: ${tier.displayName}`);
  }

  console.log("Tiers seeded successfully!");
}

seedTiers()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Run with: npx tsx prisma/seed-tiers.ts