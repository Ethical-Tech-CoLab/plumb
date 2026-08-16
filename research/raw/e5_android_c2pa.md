===== https://blog.google/security/pixel-android-trusted-images-c2pa-content-credentials/ =====
Android Device Trust Diagram Infographic detailing a five-step security process to guarantee content authenticity:  1. Hardware Trust: Ensures integrity from power-on.  2. Genuine Device and Software: Verifies that the device and operating system are genuine.  3. Genuine Application: Confirms the legitimacy of installed applications.  4. Verify then Provision: Issues security certificates to registered applications.  5. Tamper-Resistant Key Storage: Securely stores signing keys in Android StrongBox.

The C2PA Conformance Program requires verifiable artifacts backed by a hardware Root of Trust, which Android provides through features like Key Attestation. This means Android developers can leverage these same tools to build apps that meet this standard for their users. [...] How Pixel and Android are bringing a new level of trust to your images with C2PA Content Credentials

Security

# How Pixel and Android are bringing a new level of trust to your images with C2PA Content Credentials

Sep 10, 2025

Eric Lynch

Sherif Hanna

At Made by Google 2025, we announced that the new Google Pixel 10 phones will support C2PA Content Credentials in Pixel Camera and Google Photos. This announcement represents a series of steps towards greater digital media transparency:

These capabilities are powered by Google Tensor G5, Titan M2 security chip, the advanced hardware-backed security features of the Android platform, and Pixel engineering expertise. [...] The Pixel Camera application on the Pixel 10 lineup has achieved Assurance Level 2, the highest security rating currently defined by the C2PA Conformance Program. This was made possible by a strong set of hardware-backed technologies, including Tensor G5 and the certified Titan M2 security chip, along with Android’s hardware-backed security APIs. Only mobile apps running on devices that have the necessary silicon features and Android APIs can be designed to achieve this assurance level. We are working with C2PA to help define future assurance levels that will push protections even deeper into hardware.

===== https://c2pa.org/faqs/ =====
This is often referred to as “Durable Content Credentials,” providing resilience in cases where metadata is accidentally or intentionally stripped.

### Can the C2PA technology be used in offline contexts? For example, with a camera device that is often not connected to the internet.

Yes. C2PA is designed to support offline workflows. Devices like cameras can securely generate and sign Content Credentials using locally stored cryptographic keys, without needing to be connected to the internet. Certificates can be provisioned in advance or renewed later when connectivity resumes.

### Is licensing required to use the C2PA technology?

### What is the C2PA Trust List, and how does it ensure trustworthiness in the ecosystem? [...] THE LINUX FOUNDATION PROJECTS
C2PA Logo

# FAQs

### What are Content Credentials?

### What makes Content Credentials a key component to helping users make sense of what they see online?

People are increasingly concerned about being able to identify content that has been generated or edited by generative AI systems, or conversely, content that is generally unadulterated since its capture by e.g. a camera. Content provenance enables them to answer that question, which empowers them to decide how useful or reliable a piece of content is for their use case.

### How can consumers of C2PA data be assured the data was captured correctly? [...] Consumers can trust that C2PA data was captured correctly because each Content Credential (also known as a C2PA Manifest) is digitally signed by a trusted implementation. These credentials include cryptographic hashes of both the asset and the provenance data. Any modification—intentional or accidental—will break this cryptographic linkage, signalling tampering.

Additionally, the C2PA Conformance Program ensures that products creating Content Credentials meet stringent technical and security requirements and are vetted by the Administering Authority. These products are then listed in the C2PA Conforming Products List, providing visibility into which implementations are trusted.

### How are signing certificates issued to implementers of the C2PA specification?

