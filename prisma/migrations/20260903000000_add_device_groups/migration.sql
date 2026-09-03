-- CreateTable
CREATE TABLE "DeviceGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceGroup_userId_idx" ON "DeviceGroup"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceGroup_userId_name_key" ON "DeviceGroup"("userId", "name");

-- CreateIndex
CREATE INDEX "DeviceGroupMember_userId_agentId_idx" ON "DeviceGroupMember"("userId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceGroupMember_groupId_agentId_key" ON "DeviceGroupMember"("groupId", "agentId");

-- AddForeignKey
ALTER TABLE "DeviceGroup" ADD CONSTRAINT "DeviceGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceGroupMember" ADD CONSTRAINT "DeviceGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DeviceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;