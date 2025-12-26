import { prisma } from '../src/backend/db/client';

async function main() {
  await prisma.$connect();
  const notifs = await prisma.notification.findMany({
    orderBy: { sentAt: 'desc' },
    include: { matchResult: { include: { note: true } } },
  });
  console.log('Notifications:', notifs.length);
  for (const n of notifs) {
    console.log({
      id: n.id,
      status: n.status,
      matchResultId: n.matchResultId,
      noteSymbol: n.matchResult?.note?.symbol,
    });
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });