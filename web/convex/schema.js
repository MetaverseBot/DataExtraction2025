import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  donationBatches: defineTable({
    createdAt: v.number(),
    fileNames: v.array(v.string()),
    totalRecords: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  donations: defineTable({
    batchId: v.id("donationBatches"),
    name: v.string(),
    date: v.string(),
    amount: v.string(),
    paymentType: v.string(),
    email: v.string(),
  })
    .index("by_batchId", ["batchId"])
    .index("by_name", ["name"]),
});
