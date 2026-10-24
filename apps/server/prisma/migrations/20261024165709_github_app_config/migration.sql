-- CreateTable
CREATE TABLE "GithubAppConfig" (
    "id" TEXT NOT NULL DEFAULT 'app',
    "appId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "privateKeyEnc" TEXT NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "webhookSecretEnc" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubAppConfig_pkey" PRIMARY KEY ("id")
);
