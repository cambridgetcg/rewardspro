import { json } from "@remix-run/node";

export const loader = async () => {
  // First, check if DATABASE_URL exists
  const hasDbUrl = !!process.env.DATABASE_URL;
  const dbUrl = process.env.DATABASE_URL || "NOT SET";
  
  // Mask the password for security
  const maskedUrl = dbUrl.replace(/:([^@]+)@/, ':****@');
  
  try {
    // Try a direct connection without Prisma
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    
    // Test query
    const result = await prisma.$queryRaw`SELECT NOW() as time, current_database() as db`;
    
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    
    await prisma.$disconnect();
    
    return json({ 
      success: true,
      hasDbUrl,
      maskedUrl,
      result,
      tables
    });
  } catch (error) {
    // Handle unknown error type
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    return json({ 
      success: false,
      hasDbUrl,
      maskedUrl,
      error: errorMessage,
      stack: errorStack
    });
  }
};