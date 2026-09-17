-- Admin-assigned support staff on tickets: nullable FK to User (null = unassigned).
-- Every ticket lands with the admin first; admin decides whether/who to assign,
-- and a staff member only sees/acts on tickets assigned to them. Additive and
-- backward-compatible — existing tickets simply stay unassigned.
ALTER TABLE "Ticket" ADD COLUMN "assignedStaffId" TEXT;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddIndex
CREATE INDEX "Ticket_assignedStaffId_status_idx" ON "Ticket"("assignedStaffId", "status");