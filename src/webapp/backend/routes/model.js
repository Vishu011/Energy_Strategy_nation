const router = require("express").Router();
const Data = require("./../models/data");
const { spawn } = require("child_process");

// Dictionary to track user prediction requests
let status = {};

// Endpoint to start energy prediction for a given time range
router.route("/predict").post(function (req, res) {
  // Delete any existing user-specific prediction data
  Data.deleteMany({ dataType: "user-" + req.body.username })
    .then((resp) => {
      let token = Date.now().toString(); // Unique token for the current prediction request
      status[req.body.username] = [token, false];
      res.status(200).json({ token: token });

      // Spawn a Python process to run the prediction script
      const process = spawn("python", [
        "./models/model.py",
        req.body.fromDate,
        req.body.fromTime,
        req.body.toDate,
        req.body.toTime,
        req.body.username,
        token,
      ]);

      // Handle output from the Python script
      process.stdout.on("data", (data) => {
        console.log(`Python output: ${data.toString()}`); // Log data for debugging
        if (
          status[req.body.username] !== undefined &&
          status[req.body.username][0] === token
        ) {
          status[req.body.username][1] = true;
        }
      });

      // Handle errors from the Python script
      process.stderr.on("data", (data) => {
        console.error(`Python error: ${data.toString()}`); // Log errors for debugging
      });
    })
    .catch((err) => {
      res.status(400).json(err);
    });
});

// Endpoint to get all data
router.route("/").get(function (req, res) {
  Data.find(function (err, data) {
    if (err) {
      res.status(400).json(err);
    } else {
      res.status(200).json(data);
    }
  });
});

// Helper function to format integer to two-digit string
const str = (val) => {
  return val < 10 ? "0" + val.toString() : val.toString();
};

// Helper function to parse integer from string
const int = (val) => {
  return parseInt(val);
};

// Endpoint to retrieve temperature data in a date-temperature dictionary format
router.route("/load/temp").post(function (req, res) {
  Data.find({ dataType: "temp" })
    .then((data) => {
      let temp = {};
      data.forEach((entry) => {
        const dateStr = entry.year
          ? `${str(entry.year)}-${str(entry.month)}-${str(entry.day)} ${str(entry.hour)}`
          : str(entry.hour);
        temp[dateStr] = entry.value;
      });
      res.status(200).json(temp);
    })
    .catch((err) => {
      res.status(400).json(err);
    });
});

// Endpoint to save temperature data
router.route("/add/temp").post(function (req, res) {
  const tempData = req.body;
  let data = [];
  for (let key in tempData) {
    if (key.includes(" ")) {
      const [dateStr, hour] = key.split(" ");
      const [year, month, day] = dateStr.split("-");
      data.push({
        dataType: "temp",
        year: int(year),
        month: int(month),
        day: int(day),
        hour: int(hour),
        value: tempData[key],
      });
    } else {
      data.push({
        dataType: "temp",
        hour: int(key),
        value: tempData[key],
      });
    }
  }

  // Clear existing temperature data and insert new data
  Data.deleteMany({ dataType: "temp" })
    .then(() => {
      Data.collection.insertMany(data, function (err, docs) {
        if (err) {
          res.status(400).json(err);
        } else {
          res.status(200).json(docs);
        }
      });
    })
    .catch((err) => {
      res.status(400).json(err);
    });
});

// Endpoint to retrieve cached predicted energy data
router.route("/load/predict-data").post(function (req, res) {
  Data.find({ $or: [{ dataType: "act" }, { dataType: "avg" }] })
    .then((data) => {
      let pred = {};
      data.forEach((entry) => {
        const dateStr = `${str(entry.year)}-${str(entry.month)}-${str(entry.day)} ${str(entry.hour)}`;
        if (!pred[entry.dataType]) {
          pred[entry.dataType] = {};
        }
        pred[entry.dataType][dateStr] = entry.value;
      });
      res.status(200).json(pred);
    })
    .catch((err) => {
      res.status(400).json(err);
    });
});

// Endpoint to cache predicted energy data
router.route("/add/predict-data").post(function (req, res) {
  const predictionData = req.body;
  let data = [];

  for (let type in predictionData) {
    for (let dateStr in predictionData[type]) {
      const [date, hour] = dateStr.split(" ");
      const [year, month, day] = date.split("-");
      data.push({
        dataType: type,
        year: int(year),
        month: int(month),
        day: int(day),
        hour: int(hour),
        value: predictionData[type][dateStr],
      });
    }
  }

  // Clear existing prediction data and insert new data
  Data.deleteMany({ $or: [{ dataType: "act" }, { dataType: "avg" }] })
    .then(() => {
      Data.collection.insertMany(data, function (err, docs) {
        if (err) {
          res.status(400).json(err);
        } else {
          res.status(200).json(docs);
        }
      });
    })
    .catch((err) => {
      res.status(400).json(err);
    });
});

// Endpoint to retrieve day-wise predicted energy data
router.route("/load/day-data").post(function (req, res) {
  const { username, token } = req.body;

  if (!status[username] || status[username][0] !== token) {
    res.status(200).json({ data: [], end: false });
    return;
  }

  Data.find({ dataType: "user-" + username })
    .then((data) => {
      let pred = [];
      data.forEach((entry) => {
        const dateStr = `${str(entry.year)}-${str(entry.month)}-${str(entry.day)}`;
        if (pred.length && pred[pred.length - 1].date === dateStr) {
          pred[pred.length - 1].yhat += entry.value;
        } else {
          pred.push({ date: dateStr, yhat: entry.value });
        }
      });
      res.status(200).json({ data: pred, end: status[username][1] });
    })
    .catch((err) => {
      res.status(400).json(err);
    });
});

// Endpoint to retrieve hour-wise predicted energy data
router.route("/load/hour-data").post(function (req, res) {
  const { username, token } = req.body;

  if (!status[username] || status[username][0] !== token) {
    res.status(200).json({ data: [], end: false });
    return;
  }

  Data.find({ dataType: "user-" + username })
    .then((data) => {
      let pred = data.map((entry) => ({
        date: `${str(entry.year)}-${str(entry.month)}-${str(entry.day)} ${str(entry.hour)}`,
        yhat: entry.value,
      }));
      res.status(200).json({ data: pred, end: status[username][1] });
    })
    .catch((err) => {
      res.status(400).json(err);
    });
});

// Endpoint to save user's requested predicted hour-wise energy data
router.route("/add/hour-data").post(function (req, res) {
  const { username, token, data: predictionData } = req.body;

  if (!status[username] || status[username][0] !== token) {
    res.status(200).json({ message: "STOP" });
    return;
  }

  const type = "user-" + username;
  let data = predictionData.map((entry) => {
    const [date, hour] = entry.dateTime.split(" ");
    const [year, month, day] = date.split("-");
    return {
      dataType: type,
      year: int(year),
      month: int(month),
      day: int(day),
      hour: int(hour),
      value: entry.yhat,
    };
  });

  // Clear existing data for the user and insert new prediction data
  Data.deleteMany({ dataType: type })
    .then(() => {
      Data.collection.insertMany(data, function (err, docs) {
        if (err) {
          res.status(400).json(err);
        } else {
          res.status(200).json(docs);
        }
      });
    })
    .catch((err) => {
      res.status(400).json(err);
    });
});

module.exports = router;
