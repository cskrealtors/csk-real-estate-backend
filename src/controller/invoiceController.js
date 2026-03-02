import Invoice from "../modals/invoice.js";
import Project from "../modals/projects.js";
import mongoose from "mongoose";
import Payment from "../modals/payment.js";

export const createInvoice = async (req, res) => {
  try {
    const user = req.user._id;
    let role;
    if (req.user.role === "contractor") {
      role = "contractor";
    } else if (req.user.role === "accountant") {
      role = "accountant";
    } else if (req.user.role === "admin") {
      role = "admin";
    } else if (req.user.role === "owner") {
      role = "owner";
    }
    const {
      project,
      task,
      issueDate,
      dueDate,
      items,
      sgst,
      cgst,
      notes,
      unit,
      floorUnit,
    } = req.body;

    console.log(req.body);

    const subtotal = items.reduce((sum, item) => {
      const amount = item.quantity * item.rate;
      item.amount = amount;
      return sum + amount;
    }, 0);

    const sgstAmount = (sgst / 100) * subtotal;
    const cgstAmount = (cgst / 100) * subtotal;
    const total = subtotal + sgstAmount + cgstAmount;

    // Step 1: Create invoice (without invoiceNumber first)
    const invoice = new Invoice({
      project,
      task: task || null,
      user,
      issueDate,
      dueDate,
      items,
      sgst,
      cgst,
      notes,
      subtotal,
      total,
      unit,
      createdBy: role,
      floorUnit,
    });

    // Step 2: Save to generate _id
    await invoice.save();

    // Step 3: Generate readable invoice number
    const shortId = invoice._id.toString().slice(0, 6); // or use slice(-6) for last 6 chars
    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${shortId.toUpperCase()}`;

    // Step 4: Update invoice with invoiceNumber
    invoice.invoiceNumber = invoiceNumber;
    await invoice.save(); // update with invoiceNumber

    return res.status(201).json(invoice);
  } catch (error) {
    console.error("Invoice creation error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getCompletedTasksForContractor = async (req, res) => {
  try {
    const contractor = req.user._id;

    if (!contractor || !mongoose.Types.ObjectId.isValid(contractor)) {
      return res
        .status(400)
        .json({ error: "Valid contractor ID is required." });
    }

    // Populate projectId to get actual project details (like name)
    const projects = await Project.find({ contractors: contractor }).populate(
      "projectId"
    );

    const completedTasks = [];

    projects.forEach((project) => {
      project.units.forEach((tasksArray, unitName) => {
        tasksArray.forEach((task) => {
          if (
            task.contractor.toString() === contractor.toString() &&
            task.statusForContractor === "completed" &&
            task.isApprovedByContractor === true &&
            task.isApprovedBySiteManager === true
          ) {
            completedTasks.push({
              taskId: task._id,
              title: task.title,
              unit: unitName,
              projectId: project._id,
              projectName: project.projectId.projectName || "Unknown Project",
              submittedOn: task.submittedByContractorOn,
              deadline: task.deadline,
            });
          }
        });
      });
    });

    res.status(200).json({ tasks: completedTasks });
  } catch (error) {
    console.error("Error fetching completed tasks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllInvoices = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    let invoices;

    // Filter invoices based on role
    if (role === "contractor") {
      invoices = await Invoice.find({ user: userId }).sort({ issueDate: -1 });
    } else if (role === "accountant") {
      invoices = await Invoice.find({
        $or: [
          { createdBy: "contractor" },
          { user: userId }, // invoices made by this accountant
        ],
      }).sort({ issueDate: -1 });
    } else if (role === "owner") {
      invoices = await Invoice.find({
        $or: [
          { createdBy: "contractor" },
          { user: userId }, // invoices made by this accountant
        ],
      }).sort({ issueDate: -1 });
    } else if (role === "admin") {
      invoices = await Invoice.find({
        $or: [
          { createdBy: "contractor" },
          { user: userId }, // invoices made by this accountant
        ],
      }).sort({ issueDate: -1 });
    }

    // Populate project → property.basicInfo
    await Promise.all(
      invoices.map(async (invoice) => {
        await invoice.populate([
          {
            path: "project",
            model: "Building",
            select: "_id projectName propertyType constructionStatus soldUnits",
          },
          {
            path: "floorUnit",
            model: "FloorUnit",
            select: "_id floorNumber unitType",
          },
          {
            path: "unit",
            model: "PropertyUnit",
            select: "_id plotNo propertyType",
          },
        ]);

        // Now add `taskObject` only if `invoice.task` is present
        if (invoice.task && invoice.project?.units) {
          const unitsMap = invoice.project.units;

          for (const [unitName, taskArray] of unitsMap.entries()) {
            const matchedTask = taskArray.find(
              (task) => task._id.toString() === invoice.task.toString()
            );
            if (matchedTask) {
              // Attach the full task object to the invoice
              invoice._doc.taskObject = matchedTask; // use `_doc` to add virtual field
              invoice._doc.unitName = unitName; // optional: add unit info
              break;
            }
          }
        }
      })
    );

    res.status(200).json(invoices);
  } catch (error) {
    console.error("Error fetching invoices:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// export const markInvoiceAsPaid = async (req, res) => {
//   const { id } = req.params;
//   const { paymentMethod } = req.body;
//   try {

//   } catch (error) {
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

// export const markInvoiceAsPaid = async (req, res) => {
//   const { id } = req.params;
//   const { paymentMethod, reconciliationAmount, isPaid, reconciledItemId } =
//     req.body;
//   const reconcile = req.query.reconcile === "true";

//   try {
//     if (!reconcile) {
//       const invoice = await Invoice.findByIdAndUpdate(
//         id,
//         { status: "paid", paymentMethod, paymentDate: Date.now() },
//         { new: true }
//       );

//       if (!invoice) {
//         return res.status(404).json({ message: "Invoice not found" });
//       }

//       // Step 2: Create new Payment record
//       const payment = new Payment({
//         accountant: req.user._id,
//         invoice: id,
//         paymentNumber: "", // temp, will be updated after saving
//       });

//       await payment.save();

//       // Step 3: Generate readable payment number
//       const shortId = payment._id.toString().slice(0, 6);
//       const year = new Date().getFullYear();
//       payment.paymentNumber = `PAY-${year}-${shortId.toUpperCase()}`;

//       await payment.save(); // update with generated payment number

//       res
//         .status(200)
//         .json({ message: "Invoice marked as paid", invoice, payment });
//     }

//     const invoice = await Invoice.findById(id);

//     if (!invoice) {
//       return res.status(404).json({ message: "Invoice not found" });
//     }

//     // Step 1: If reconcile is true, update invoice total and add to reconciliation history
//     if (reconcile && reconciliationAmount != null && reconciledItemId) {
//       const item = invoice.items.find(
//         (it) => it._id.toString() === reconciledItemId.toString()
//       );

//       if (!item) {
//         return res.status(404).json({ message: "Reconciled item not found" });
//       }

//       // Update item amount (increase it)
//       item.amount += reconciliationAmount;

//       // Recalculate subtotal from all items
//       const newSubtotal = invoice.items.reduce(
//         (acc, curr) => acc + curr.amount,
//         0
//       );
//       invoice.subtotal = newSubtotal;

//       // Recalculate tax amounts
//       const sgstAmount = (invoice.sgst / 100) * newSubtotal;
//       const cgstAmount = (invoice.cgst / 100) * newSubtotal;
//       invoice.total = newSubtotal + sgstAmount + cgstAmount;

//       // Push to reconciliation history
//       invoice.reconciliationHistory.push({
//         item: item.description,
//         amount: reconciliationAmount,
//         method: isPaid ? paymentMethod : "N/A",
//         note: isPaid ? "Reconciled and paid" : "Reconciled without payment",
//       });

//       // If invoice is being paid
//       if (isPaid) {
//         invoice.status = "paid";
//         invoice.paymentDate = new Date();

//         if (!invoice.paymentMethod.includes(paymentMethod)) {
//           invoice.paymentMethod.push(paymentMethod);
//         }

//         await invoice.save();

//         return res.status(200).json({
//           message: "Invoice reconciled and marked as paid",
//           invoice,
//         });
//       }

//       // If only reconciled
//       invoice.status = "pending";
//       await invoice.save();

//       return res.status(200).json({
//         message: "Invoice reconciled (not paid)",
//         invoice,
//       });
//     }
//   } catch (error) {
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };


export const markInvoiceAsPaid = async (req, res) => {
  const { id } = req.params;
  const { paymentMethod, reconciliationAmount, isPaid, reconciledItemId } =
    req.body;
  const reconcile = req.query.reconcile === "true";

  // 🔔 Notification helper (ADDED)
  const notifyRevenueReceived = async (invoice) => {
    const receivers = await User.find({
      role: { $in: ["owner", "accountant"] },
    }).select("_id");

    await Promise.all(
      receivers.map((user) =>
        createNotification({
          userId: user._id,
          title: "Payment Received",
          message: `Invoice ${
            invoice.invoiceNumber || invoice._id
          } has been paid.`,
          triggeredBy: req.user._id,
        })
      )
    );
  };

  try {
    if (!reconcile) {
      const invoice = await Invoice.findByIdAndUpdate(
        id,
        { status: "paid", paymentMethod, paymentDate: Date.now() },
        { new: true }
      );

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      // Step 2: Create new Payment record
      const payment = new Payment({
        accountant: req.user._id,
        invoice: id,
        paymentNumber: "", // temp, will be updated after saving
      });

      await payment.save();

      // Step 3: Generate readable payment number
      const shortId = payment._id.toString().slice(0, 6);
      const year = new Date().getFullYear();
      payment.paymentNumber = `PAY-${year}-${shortId.toUpperCase()}`;

      await payment.save(); // update with generated payment number

      // 🔔 Notify Owner + Accountant (ADDED)
      await notifyRevenueReceived(invoice);

      return res
        .status(200)
        .json({ message: "Invoice marked as paid", invoice, payment });
    }

    const invoice = await Invoice.findById(id);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Step 1: If reconcile is true, update invoice total and add to reconciliation history
    if (reconcile && reconciliationAmount != null && reconciledItemId) {
      const item = invoice.items.find(
        (it) => it._id.toString() === reconciledItemId.toString()
      );

      if (!item) {
        return res.status(404).json({ message: "Reconciled item not found" });
      }

      // Update item amount (increase it)
      item.amount += reconciliationAmount;

      // Recalculate subtotal from all items
      const newSubtotal = invoice.items.reduce(
        (acc, curr) => acc + curr.amount,
        0
      );
      invoice.subtotal = newSubtotal;

      // Recalculate tax amounts
      const sgstAmount = (invoice.sgst / 100) * newSubtotal;
      const cgstAmount = (invoice.cgst / 100) * newSubtotal;
      invoice.total = newSubtotal + sgstAmount + cgstAmount;

      // Push to reconciliation history
      invoice.reconciliationHistory.push({
        item: item.description,
        amount: reconciliationAmount,
        method: isPaid ? paymentMethod : "N/A",
        note: isPaid ? "Reconciled and paid" : "Reconciled without payment",
      });

      // If invoice is being paid
      if (isPaid) {
        invoice.status = "paid";
        invoice.paymentDate = new Date();

        if (!invoice.paymentMethod.includes(paymentMethod)) {
          invoice.paymentMethod.push(paymentMethod);
        }

        await invoice.save();

        // 🔔 Notify Owner + Accountant (ADDED)
        await notifyRevenueReceived(invoice);

        return res.status(200).json({
          message: "Invoice reconciled and marked as paid",
          invoice,
        });
      }

      // If only reconciled
      invoice.status = "pending";
      await invoice.save();

      return res.status(200).json({
        message: "Invoice reconciled (not paid)",
        invoice,
      });
    }
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const verifyInvoiceByAccountant = async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  try {
    const invoice = await Invoice.findByIdAndUpdate(
      id,
      {
        isApprovedByAccountant: status === "approved",
        noteByAccountant: notes,
      },
      { new: true } // return updated doc
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    res.status(200).json({
      message: "Invoice verification updated successfully",
      invoice,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getMonthlyRevenues = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const revenues = await Invoice.aggregate([
      {
        $match: {
          status: "paid",
          paymentDate: {
            $gte: new Date(year, 0, 1),
            $lte: new Date(year, 11, 31, 23, 59, 59, 999),
          },
        },
      },
      {
        $group: {
          _id: { $month: "$paymentDate" },
          total: { $sum: "$total" },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    const monthlyRevenues = Array(12).fill(0);
    revenues.forEach((rev) => {
      monthlyRevenues[rev._id - 1] = rev.total;
    });

    res.status(200).json(monthlyRevenues);
  } catch (error) {
    console.error("Error fetching monthly revenues:", error);
    res.status(500).json({ message: "Server error" });
  }
};
