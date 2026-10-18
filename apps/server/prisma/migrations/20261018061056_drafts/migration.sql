-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "draftOfId" TEXT;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "byHand" BOOLEAN NOT NULL DEFAULT false;
