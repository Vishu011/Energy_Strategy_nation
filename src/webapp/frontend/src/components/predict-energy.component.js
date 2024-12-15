import React, { Component } from "react";
import axios from "axios";
import { Form, Button, Alert, InputGroup, Table, Col } from "react-bootstrap";
import { CSVLink } from "react-csv";
import { Formik } from "formik";
import * as yup from "yup";

const schema = yup.object({
  fromDate: yup.date().required("Please Enter the Start Date"),
  fromTime: yup.string().required("Please Enter the Start Time"),
  toDate: yup.date().required("Please Enter the End Date"),
  toTime: yup.string().required("Please Enter the End Time"),
});

const headers = [
  { label: "DateTime", key: "date" },
  { label: "Energy (kWh)", key: "yhat" },
];

class EnergyPrediction extends Component {
  constructor(props) {
    super(props);
    this.state = {
      message: "",
      type: "light",
      interval: null,
      data: [],
      loading: false
    };
  }

  hourToDay = (data) => {
    if (data.length === 0) return [];

    let aggregatedData = [];
    let currentDate = data[0].date.split(" ")[0];
    let dailyTotal = data[0].yhat;

    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i].date.split(" ")[0];
      
      if (rowDate === currentDate) {
        dailyTotal += data[i].yhat;
      } else {
        aggregatedData.push({
          date: currentDate, 
          yhat: Math.round(dailyTotal * 100) / 100
        });
        
        currentDate = rowDate;
        dailyTotal = data[i].yhat;
      }
    }

    aggregatedData.push({
      date: currentDate, 
      yhat: Math.round(dailyTotal * 100) / 100
    });

    return aggregatedData;
  };

  fetchPredictionData = (token) => {
    console.log("Fetching prediction data with token:", token);
    console.log("Username:", this.props.match.params.id);

    axios
      .post("http://localhost:4000/model/load/hour-data", {
        username: this.props.match.params.id,
        token: token,
      })
      .then((res) => {
        console.log("API Response:", res.data);
        
        if (!res.data) {
          throw new Error("No response data received");
        }

        const data = res.data.data || [];
        
        if (res.data.end === true) {
          clearInterval(this.state.interval);
          this.setState({
            message: "Energy Prediction Completed Successfully!",
            type: "success",
            interval: null,
            data: data,
            loading: false
          });
        } else {
          this.setState({ data });
        }
      })
      .catch((err) => {
        console.error("Full Error Object:", err);
        console.error("Error Response:", err.response);
        console.error("Error Message:", err.message);

        clearInterval(this.state.interval);
        this.setState({
          message: err.response?.data?.message || 
                   err.message || 
                   "Prediction failed. Check server logs.",
          type: "danger",
          interval: null,
          loading: false
        });
      });
  };

  render() {
    const renderAlert = () => (
      this.state.message && (
        <Alert 
          variant={this.state.type} 
          onClose={() => this.setState({ message: "", type: "light" })}
          dismissible
        >
          {this.state.message}
        </Alert>
      )
    );

    const renderDownloadButton = () => (
      this.state.type === "success" && (
        <CSVLink
          data={this.state.data}
          headers={headers}
          filename={"energy_prediction.csv"}
          className="btn btn-primary"
          target="_blank"
        >
          Download Prediction Data
        </CSVLink>
      )
    );

    const renderDataTable = () => {
      const dailyData = this.hourToDay(this.state.data);
      const totalEnergy = dailyData.reduce((sum, item) => sum + item.yhat, 0);

      return (
        <Table striped bordered hover>
          <thead>
            <tr>
              <th>Date</th>
              <th>Energy (kWh)</th>
            </tr>
          </thead>
          <tbody>
            {dailyData.map((item, index) => (
              <tr key={index}>
                <td>{item.date}</td>
                <td>{item.yhat.toFixed(2)}</td>
              </tr>
            ))}
            <tr>
              <td><strong>Total</strong></td>
              <td><strong>{totalEnergy.toFixed(2)}</strong></td>
            </tr>
          </tbody>
        </Table>
      );
    };

    return (
      <div className="container">
        <h1 className="text-center my-4">Energy Consumption Prediction</h1>
        
        {renderAlert()}
        
        <Formik
          validationSchema={schema}
          initialValues={{
            fromDate: "",
            fromTime: "",
            toDate: "",
            toTime: "",
          }}
          onSubmit={(values, actions) => {
            console.log("Submission Values:", values);

            if (this.state.interval) {
              clearInterval(this.state.interval);
            }

            this.setState({
              message: "Prediction in progress. Please wait...",
              type: "warning",
              interval: null,
              data: [],
              loading: true
            });

            axios
              .post("http://localhost:4000/model/predict", {
                fromDate: values.fromDate,
                fromTime: values.fromTime,
                toDate: values.toDate,
                toTime: values.toTime,
                username: this.props.match.params.id,
              })
              .then((res) => {
                console.log("Prediction Initiation Response:", res.data);

                if (!res.data.token) {
                  throw new Error("No prediction token received");
                }

                let attempts = 0;
                const MAX_ATTEMPTS = 15;
                const POLLING_INTERVAL = 8000;

                const interval = setInterval(() => {
                  attempts++;
                  console.log(`Attempt ${attempts}: Fetching prediction data`);

                  if (attempts > MAX_ATTEMPTS) {
                    clearInterval(interval);
                    this.setState({
                      message: "Prediction timed out. Please try again or check server status.",
                      type: "danger",
                      loading: false
                    });
                  } else {
                    this.fetchPredictionData(res.data.token);
                  }
                }, POLLING_INTERVAL);

                this.setState({ interval });
              })
              .catch((err) => {
                console.error("Prediction Initiation Error:", err);
                console.error("Error Response:", err.response);

                this.setState({
                  message: err.response?.data?.message || 
                           "Failed to start prediction. Check server connection.",
                  type: "danger",
                  loading: false
                });
              })
              .finally(() => {
                actions.setSubmitting(false);
              });
          }}
        >
          {({
            handleSubmit,
            handleChange,
            handleBlur,
            values,
            touched,
            errors,
          }) => (
            <Form onSubmit={handleSubmit}>
              <Form.Row>
                <Form.Group as={Col} md="6">
                  <Form.Label>From</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="date"
                      name="fromDate"
                      value={values.fromDate}
                      onChange={handleChange}
                      isInvalid={touched.fromDate && errors.fromDate}
                    />
                    <Form.Control
                      type="time"
                      name="fromTime"
                      value={values.fromTime}
                      onChange={handleChange}
                      isInvalid={touched.fromTime && errors.fromTime}
                    />
                    <Form.Control.Feedback type="invalid">
                      {errors.fromDate || errors.fromTime}
                    </Form.Control.Feedback>
                  </InputGroup>
                </Form.Group>

                <Form.Group as={Col} md="6">
                  <Form.Label>To</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="date"
                      name="toDate"
                      value={values.toDate}
                      onChange={handleChange}
                      isInvalid={touched.toDate && errors.toDate}
                    />
                    <Form.Control
                      type="time"
                      name="toTime"
                      value={values.toTime}
                      onChange={handleChange}
                      isInvalid={touched.toTime && errors.toTime}
                    />
                    <Form.Control.Feedback type="invalid">
                      {errors.toDate || errors.toTime}
                    </Form.Control.Feedback>
                  </InputGroup>
                </Form.Group>
              </Form.Row>

              <Button 
                type="submit" 
                variant="primary" 
                disabled={this.state.loading}
              >
                {this.state.loading ? 'Processing...' : 'Predict Energy'}
              </Button>
            </Form>
          )}
        </Formik>
        
        <div className="mt-4">
          {this.state.data.length > 0 && renderDataTable()}
        </div>
        
        <div className="mt-3">
          {renderDownloadButton()}
        </div>
      </div>
    );
  }
}

export default EnergyPrediction;