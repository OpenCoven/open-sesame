import XCTest

final class MobileGateUITests: XCTestCase {
    func testSignedOutLaunchAndAuthenticationCancellation() throws {
        let app=XCUIApplication();app.launch()
        let signIn=app.buttons["Sign in"];XCTAssertTrue(signIn.waitForExistence(timeout:15))
        XCTAssertFalse(app.buttons["Workspace files"].exists)
        XCTAssertEqual(app.webViews.count,0,"No privileged workspace mounts before verified sign-in")
        signIn.tap()
        let springboard=XCUIApplication(bundleIdentifier:"com.apple.springboard")
        let cancel=springboard.alerts.buttons["Cancel"]
        if cancel.waitForExistence(timeout:5){cancel.tap()}else{
            let browserCancel=app.buttons["Cancel"];XCTAssertTrue(browserCancel.waitForExistence(timeout:15));browserCancel.tap()
        }
        XCTAssertTrue(signIn.waitForExistence(timeout:15));XCTAssertEqual(app.webViews.count,0)
        let shot=XCTAttachment(screenshot:app.screenshot());shot.name="Signed-out native gate after cancellation";shot.lifetime = .keepAlways;add(shot)
    }
}
