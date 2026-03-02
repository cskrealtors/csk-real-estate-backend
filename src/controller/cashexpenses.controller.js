import mongoose from "mongoose";
import { CashExpensesModel } from "../modals/cashexpenses.model.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { uploadFile } from "../utils/uploadFile.js";

export const createTransaction = asyncHandler(async (req, res) => {
  const {
    date,
    amount,
    modeOfPayment,
    project,
    company,
    transactionType,
    description,
    partyName,
    paymentDetails,
    expenseCategory,
    notes,
  } = req.body;

  if (
    !date ||
    !amount ||
    !modeOfPayment ||
    !transactionType ||
    !expenseCategory
  ) {
    throw new ApiError(400, "Required fields are missing");
  }

  let proofBillUrl;

  if (req.file) {
    proofBillUrl = await uploadFile(req.file.path, "proofBill");
  }

  const transaction = await CashExpensesModel.create({
    date,
    amount,
    modeOfPayment,
    project,
    company,
    transactionType,
    description,
    partyName,
    paymentDetails,
    expenseCategory,
    notes,
    proofBillUrl,
    createdBy: req.user._id,
  });

  // 🔔 Notify Admin & Accountant about new expense request
  const receivers = await User.find({
    role: { $in: ["admin", "accountant"] },
  }).select("_id");

  await Promise.all(
    receivers.map((user) =>
      createNotification({
        userId: user._id,
        title: "New Expense Request",
        message: `A new expense request of ₹${amount} has been submitted and needs approval.`,
        triggeredBy: req.user._id,
      })
    )
  );

  return res
    .status(201)
    .json(
      new ApiResponse(201, transaction, "Transaction created successfully"),
    );
});

export const getAllTransactions = asyncHandler(async (req, res) => {
  const {
    project,
    company,
    transactionType,
    expenseCategory,
    fromDate,
    toDate,
  } = req.query;

  const filter = { isDeleted: false };

  if (project) filter.project = project;
  if (company) filter.company = company;
  if (transactionType) filter.transactionType = transactionType;
  if (expenseCategory) filter.expenseCategory = expenseCategory;

  if (fromDate || toDate) {
    filter.date = {};
    if (fromDate) filter.date.$gte = new Date(fromDate);
    if (toDate) filter.date.$lte = new Date(toDate);
  }

  const transactions = await CashExpensesModel.find(filter)
    .populate("project", "_id name")
    .populate("company", "_id name")
    .sort({ date: -1 });

  return res
    .status(200)
    .json(
      new ApiResponse(200, transactions, "Transactions fetched successfully"),
    );
});

export const getTransactionById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid transaction ID");
  }

  const transaction = await CashExpensesModel.findOne({
    _id: id,
    isDeleted: false,
  })
    .populate("project", "_id name")
    .populate("company", "_id name");

  if (!transaction) {
    throw new ApiError(404, "Transaction not found");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, transaction, "Transaction fetched successfully"),
    );
});

export const updateTransaction = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid transaction ID");
  }

  const transaction = await CashExpensesModel.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!transaction) {
    throw new ApiError(404, "Transaction not found");
  }

  let proofBillUrl = transaction.proofBillUrl;

  if (req.file) {
    proofBillUrl = await uploadFile(req.file.path, "proofBill");
  }

  const updatedTransaction = await CashExpensesModel.findByIdAndUpdate(
    id,
    {
      ...req.body,
      proofBillUrl,
      updatedBy: req.user._id,
    },
    { new: true, runValidators: true },
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        updatedTransaction,
        "Transaction updated successfully",
      ),
    );
});

export const deleteTransaction = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid transaction ID");
  }

  const transaction = await CashExpensesModel.findOneAndUpdate(
    { _id: id, isDeleted: false },
    { isDeleted: true, deletedBy: req.user._id },
    { new: true },
  );

  if (!transaction) {
    throw new ApiError(404, "Transaction not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Transaction deleted successfully"));
});
