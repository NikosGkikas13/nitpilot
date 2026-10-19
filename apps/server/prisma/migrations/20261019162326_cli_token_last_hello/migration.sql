-- AlterTable
ALTER TABLE "CliToken" ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "agentVersion" TEXT,
ADD COLUMN     "repos" TEXT[] DEFAULT ARRAY[]::TEXT[];
