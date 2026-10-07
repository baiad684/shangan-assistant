-- CreateTable
CREATE TABLE "Subject" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "archivedAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CompletedItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "subjectId" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompletedItem_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FocusSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" TEXT,
    "subjectId" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "localDate" TEXT NOT NULL,
    "focusMinutes" INTEGER NOT NULL,
    "plannedMinutes" INTEGER,
    "pausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FocusSession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Achievement" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "unlockedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CompletedItem_localDate_idx" ON "CompletedItem"("localDate");

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_clientId_key" ON "FocusSession"("clientId");

-- CreateIndex
CREATE INDEX "FocusSession_localDate_idx" ON "FocusSession"("localDate");

-- CreateIndex
CREATE INDEX "FocusSession_subjectId_idx" ON "FocusSession"("subjectId");
