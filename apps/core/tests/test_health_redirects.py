from django.test import Client, SimpleTestCase, override_settings


@override_settings(
    SECURE_SSL_REDIRECT=True,
    SECURE_REDIRECT_EXEMPT=[
        r"^api/v1/health/$",
        r"^api/v1/health/ready/$",
    ],
)
class HealthRedirectExemptionTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    def test_liveness_health_check_is_not_redirected_to_https(self):
        response = self.client.get("/api/v1/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/json")

    def test_readiness_health_check_is_not_redirected_to_https(self):
        response = self.client.get("/api/v1/health/ready/")

        self.assertNotEqual(response.status_code, 301)
        self.assertEqual(response["Content-Type"], "application/json")
