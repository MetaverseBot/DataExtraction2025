import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const saveBatch = mutation({
  args: {
    fileNames: v.array(v.string()),
    records: v.array(
      v.object({
        name: v.string(),
        date: v.string(),
        amount: v.string(),
        paymentType: v.string(),
        email: v.string(),
        sourceFileName: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const batchId = await ctx.db.insert("donationBatches", {
      createdAt: Date.now(),
      fileNames: args.fileNames,
      totalRecords: args.records.length,
    });

    for (const record of args.records) {
      await ctx.db.insert("donations", {
        batchId,
        ...record,
      });
    }

    return batchId;
  },
});

export const getRecentBatches = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("donationBatches")
      .withIndex("by_createdAt")
      .order("desc")
      .take(30);
  },
});

export const getBatchById = query({
  args: {
    batchId: v.id("donationBatches"),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) {
      throw new Error("Batch not found.");
    }

    const donations = await ctx.db
      .query("donations")
      .withIndex("by_batchId", (queryBuilder) =>
        queryBuilder.eq("batchId", args.batchId),
      )
      .collect();

    return { batch, donations };
  },
});
