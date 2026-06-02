const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { IngredientMaster, CategoryMaster, TempIngredients } = require("../models/model");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// CORE AI PROCESSING (TRANSACTIONAL)
// ==========================================
const coreProcessAI = async () => {
  // 1. Fetch pending items
  const pendingItems = await TempIngredients.find({ status: "pending" }).limit(30);

  if (pendingItems.length === 0) {
    return { success: true, message: "Tidak ada bahan pending untuk diproses.", processed: 0 };
  }

  const rawNames = pendingItems.map((item) => ({
    id: item._id,
    raw_name: item.raw_name,
  }));

  // 2. Setup Gemini AI Model
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash-latest",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `
    Kamu adalah sistem analisis bahan makanan ahli. Tugasmu adalah memvalidasi dan memformat ulang daftar bahan makanan mentah (raw_name) dari user.
    
    Aturan Food Group (PILIH SALAH SATU YANG PALING COCOK):
    - Vegetables
    - Seasonings and Spices
    - Meat
    - Seafood
    - Condiments
    - Legumes
    - Grains
    - Dairy & Eggs
    - Fats and Oils
    - Fruits
    - Beverages
    - Other Ingredients

    Aturan Flavor Vector (Array 7 Float 0.0 - 1.0, URUTAN WAJIB):
    [manis, asin, asam, pahit, umami, pedas, aromatik]

    Aturan Evaluasi (status):
    - Jika input benar-benar bahan makanan/minuman, status: "approved", decline_reason: null
    - Jika input adalah kata kasar, benda mati (contoh: "batu", "piring"), atau kalimat tidak jelas, status: "declined", decline_reason: "Alasan penolakan (contoh: Bukan bahan makanan)"
    
    KEMBALIKAN HANYA ARRAY JSON VALID SEPERTI STRUKTUR INI UNTUK SETIAP ITEM:
    [
      {
        "temp_id": "ID_DARI_INPUT",
        "clean_name": "nama bersih huruf kecil semua",
        "display_name": "Nama Bersih (Camel/Title Case)",
        "food_group": "Salah satu kategori di atas",
        "flavor_vector": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        "status": "approved atau declined",
        "decline_reason": "alasan jika declined, null jika approved"
      }
    ]

    Ini data inputnya:
    ${JSON.stringify(rawNames)}
  `;

  // 3. Process AI Generation
  const result = await model.generateContent(prompt);
  const aiResults = JSON.parse(result.response.text());

  // 4. Initialize MongoDB Transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  let approvedCount = 0;
  let declinedCount = 0;

  try {
    const lastIngredient = await IngredientMaster.findOne()
      .sort({ ingredient_id: -1 })
      .session(session);

    let currentCounter = 0;
    if (lastIngredient && lastIngredient.ingredient_id) {
      const lastNumber = lastIngredient.ingredient_id.replace("ING-", "");
      currentCounter = parseInt(lastNumber, 10) || 0;
    }

    // 5. Process AI Results & Update DB
    for (const item of aiResults) {
      if (item.status === "approved") {
        let existingItem = await IngredientMaster.findOne({ clean_name: item.clean_name }).session(session);

        if (existingItem) {
          existingItem.display_name = item.display_name;
          existingItem.food_group = item.food_group;
          existingItem.flavor_vector = item.flavor_vector;
          await existingItem.save({ session });
        } else {
          currentCounter++;
          const newIngredientId = `ING-${String(currentCounter).padStart(4, "0")}`;

          const newIngredient = new IngredientMaster({
            ingredient_id: newIngredientId,
            clean_name: item.clean_name,
            display_name: item.display_name,
            food_group: item.food_group,
            flavor_vector: item.flavor_vector,
          });
          await newIngredient.save({ session });
        }

        await TempIngredients.findByIdAndUpdate(
          item.temp_id,
          { status: "approved" },
          { session }
        );
        approvedCount++;
      } else if (item.status === "declined") {
        await TempIngredients.findByIdAndUpdate(
          item.temp_id,
          { status: "declined", decline_reason: item.decline_reason },
          { session }
        );
        declinedCount++;
      }
    }

    // 6. Commit Transaction
    await session.commitTransaction();

    return {
      success: true,
      message: "Proses kurasi bahan selesai.",
      processed: pendingItems.length,
      approved: approvedCount,
      declined: declinedCount,
    };
  } catch (error) {
    // 7. Rollback Transaction on Error
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const metadataController = {
  // ==========================================
  // SEARCH INGREDIENTS
  // ==========================================
  searchIngredients: async (req, res) => {
    try {
      const { search } = req.query ?? null;
      let ingredients = [];

      if (search != null) {
        const cleanSearch = search.trim();
        ingredients = await IngredientMaster.find({
          display_name: { $regex: cleanSearch, $options: "i" },
        })
          .select("-flavor_vector")
          .limit(10)
          .lean();
      } else {
        ingredients = await IngredientMaster.aggregate([
          { $sample: { size: 10 } },
          { $project: { flavor_vector: 0 } },
        ]);
      }

      const formattedIngredients = ingredients.map((ing) => ({
        ingredient_id: ing.ingredient_id || ing._id,
        name: ing.display_name,
      }));

      return res.status(200).json({
        message: "Daftar bahan berhasil dimuat",
        data: formattedIngredients,
      });
    } catch (error) {
      console.error("[searchIngredients] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat mencari bahan masakan" });
    }
  },

  // ==========================================
  // SEARCH CATEGORIES
  // ==========================================
  searchCategories: async (req, res) => {
    try {
      const { search } = req.query;
      let categories = [];

      if (search && search.trim() !== "") {
        const cleanSearch = search.trim();
        categories = await CategoryMaster.find({
          name: { $regex: cleanSearch, $options: "i" },
        })
          .sort({ usage_count: -1 })
          .limit(10)
          .lean();
      } else {
        categories = await CategoryMaster.find()
          .sort({ usage_count: -1 })
          .limit(10)
          .lean();
      }

      const formattedCategories = categories.map((cat) => ({
        category_id: cat.category_id || cat._id,
        name: cat.name,
        count: cat.usage_count || 0,
      }));

      return res.status(200).json({
        message: "Daftar kategori berhasil dimuat",
        data: formattedCategories,
      });
    } catch (error) {
      console.error("[searchCategories] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat mencari kategori" });
    }
  },

  // ==========================================
  // BULK PROCESS PENDING INGREDIENTS (API)
  // ==========================================
  processPendingIngredients: async (req, res) => {
    try {
      const result = await coreProcessAI();
      return res.status(200).json(result);
    } catch (error) {
      console.error("[processPendingIngredients] API Error:", error);
      res.status(500).json({ message: "Gagal memproses bahan masakan.", error: error.message });
    }
  },
};

// ==========================================
// CRON JOB: PROCESS PENDING INGREDIENTS
// ==========================================
const processPendingIngredientsCron = async () => {
  try {
    console.log("[CRON] Memulai kurasi bahan dari AI...");
    const result = await coreProcessAI();
    console.log(`[CRON] ${result.message} Approved: ${result.approved || 0}, Declined: ${result.declined || 0}`);
  } catch (error) {
    console.error("[CRON] Curation Error:", error);
  }
};

module.exports = {
  ...metadataController,
  processPendingIngredientsCron,
};